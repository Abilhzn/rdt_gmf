import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../core/database/database.service';
import { DomainError } from '../../../core/errors/domain-error';
import { RowStatus } from '../../../core/enums/row-status.enum';
import type { Identity } from '../../../core/security/identity.interface';
import { STORAGE_SERVICE } from '../../../core/storage/storage.service';
import type { StorageService } from '../../../core/storage/storage.service';
import { validateFreeText } from '../../../core/utils/text-validation';
import { currentAutoPeriode } from '../rules/period-effective';
import { PairCommentService } from '../shared/pair-comment.service';
import { RollbackAuditService } from '../shared/rollback-audit.service';
import { ExistingTransactionRow, flagDuplicates } from './duplicate-check';
import { sanitizeFilename } from './original-file';
import { evaluateSupersede, SupersedeCandidateRow } from './supersede-check';

// Baris hasil review parse Format CBO yang dikirim client ke POST persist. Superset dari
// `DetailRow` (parser) + 2 field yang HANYA ada di layar Repost Review, sebelum baris ini
// pernah disentuh backend (sub_group/reviewer_note -- lihat migrations 011 & 015).
// document_no tidak pernah dihasilkan parser Format CBO -- selalu absent di praktiknya, tapi
// dibiarkan optional (bukan dihapus) supaya `flagDuplicates` (3.5a) tetap bisa dipakai apa
// adanya kalau suatu saat sumbernya berubah.
export interface PersistRowInput {
  sheet?: unknown;
  row?: unknown;
  dinas_inisiasi?: unknown;
  dinas_target?: unknown;
  account?: unknown;
  profit_ctr?: unknown;
  ref_doc?: unknown;
  period?: unknown;
  text_desc?: unknown;
  material?: unknown;
  in_pclc?: unknown;
  curr?: unknown;
  nominal?: number | null;
  remark?: unknown;
  category?: unknown;
  reason_if_invalid?: string | null;
  status_konfirmasi: RowStatus;
  raw_payload?: Record<string, unknown>;
  document_no?: unknown;
  cost_ctr?: unknown;
  item?: unknown;
  sub_group?: unknown;
  reviewer_note?: unknown;
}

export interface PersistResult {
  inserted: number;
  upload_id: number;
  duplicates_flagged: number;
  superseded_upload_ids: number[];
  superseded_transaction_count: number;
}

interface InsertedRow {
  id: number;
  dinas_inisiasi: string;
  dinas_target: string | null;
}

// Kolom yang di-INSERT ke rdt.transactions -- HANYA yang parser Format CBO hasilkan + turunan
// (RENCANA_REWRITE_NESTJS.md §8 Batch 3.5b). Kolom kontrak 53-lama lainnya sengaja tidak ada di
// sini (biar default NULL) -- daftar 65-kolom lama tidak relevan lagi buat Format CBO.
const INSERT_COLUMNS = [
  'upload_id',
  'dinas_inisiasi',
  'dinas_target',
  'nominal',
  'category',
  'status_konfirmasi',
  'is_reversal',
  'invalid_reason',
  'account',
  'profit_ctr',
  'ref_doc',
  'period',
  'text_desc',
  'material',
  'in_pclc',
  'curr',
  'sheet_name',
  'raw_row_index',
  'remark',
  'raw_payload',
  'sub_group',
  'reviewer_note',
] as const;

// PostgreSQL wire protocol caps bind params at 65535/query -- chunk the insert so a large file
// (ribuan baris) still lands in ONE transaction (tetap atomik), tanpa nabrak limit itu.
// Exported buat spec (verifikasi chunk split tanpa DB nyata).
export const CHUNK_SIZE = Math.max(
  1,
  Math.floor(60000 / INSERT_COLUMNS.length),
);

function nullable<T>(v: T | null | undefined): T | null {
  return v === undefined ? null : v;
}

function rowValues(uploadId: number, row: PersistRowInput): unknown[] {
  return INSERT_COLUMNS.map((col) => {
    switch (col) {
      case 'upload_id':
        return uploadId;
      case 'is_reversal':
        return row.nominal !== null && row.nominal !== undefined
          ? Number(row.nominal) < 0
          : false;
      case 'invalid_reason':
        return nullable(row.reason_if_invalid);
      case 'sheet_name':
        return nullable(row.sheet);
      case 'raw_row_index':
        return nullable(row.row);
      case 'raw_payload':
        return JSON.stringify(row.raw_payload || {});
      default:
        return nullable((row as unknown as Record<string, unknown>)[col]);
    }
  });
}

/**
 * `repost/persist` — port `POST /api/persist` + `GET /api/uploads/:id/download`
 * (`rdt/backend/src/index.js` + `routes/uploads.js`). 🔴 Zona transaksi finansial: ini yang
 * membuat sistem fungsional dari DB kosong (upload → persist → confirm → export). Reuse murni
 * dari 3.5a (`flagDuplicates`, `evaluateSupersede`, `sanitizeFilename`) + 3a (`currentAutoPeriode`,
 * `validateFreeText`) + 3c (`PairCommentService`, `RollbackAuditService`) -- tidak reinvent.
 */
@Injectable()
export class PersistService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pairComment: PairCommentService,
    private readonly rollbackAudit: RollbackAuditService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async persist(args: {
    rawRows: unknown;
    originalFilename: unknown;
    rawDescription: unknown;
    file?: { buffer: Buffer; originalname: string; mimetype?: string };
    user: Identity;
    ip: string | null;
  }): Promise<PersistResult> {
    // Pra-transaksi: semua validasi 400 di sini, JANGAN buka transaksi kalau salah satu gagal
    // (all-or-nothing, sama seperti ConfirmationService.submit, 3b).
    const rows = this.parseRows(args.rawRows);
    const period = currentAutoPeriode();
    const originalFilename = this.requireOriginalFilename(
      args.originalFilename,
    );
    const descriptionCheck = validateFreeText(args.rawDescription, {
      fieldLabel: 'Deskripsi',
    });
    if (!descriptionCheck.ok) {
      throw new DomainError(descriptionCheck.error, 400, descriptionCheck.code);
    }
    const description = descriptionCheck.value;
    const reviewedRows = this.requireValidReviewerNotes(rows);

    const uploader = args.user.dinas;
    const uploadedBy = args.user.userId;

    try {
      return await this.db.withTransaction((client) =>
        this.runPersist(client, {
          uploader,
          uploadedBy,
          period,
          originalFilename,
          description,
          rows: reviewedRows,
          file: args.file,
          ip: args.ip,
        }),
      );
    } catch (err) {
      throw await this.wrapRollback(err, uploadedBy, args.ip);
    }
  }

  // withTransaction sudah ROLLBACK sebelum re-throw. Audit rollback ditulis lewat
  // RollbackAuditService (koneksi terpisah, 3c) -- statusCode/errorCode aslinya dipertahankan
  // kalau err sudah DomainError (mis. 409 supersede blocked dari runPersist), fallback 500
  // untuk yang lain. Pola sama dengan ReassignmentService.wrapRollback.
  private async wrapRollback(
    err: unknown,
    userId: string,
    ip: string | null,
  ): Promise<DomainError> {
    const category = await this.rollbackAudit.record({
      userId,
      ip,
      err,
      route: 'repost/persist',
    });
    if (err instanceof DomainError) {
      return new DomainError(
        err.message,
        err.statusCode,
        err.errorCode,
        category,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(message, 500, 'PERSIST_FAILED', category);
  }

  private parseRows(raw: unknown): PersistRowInput[] {
    let rows: unknown;
    try {
      rows = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      throw new DomainError(
        'invalid rows: not valid JSON',
        400,
        'INVALID_ROWS_JSON',
      );
    }
    if (!Array.isArray(rows)) {
      throw new DomainError(
        'invalid body, expected { rows: [] }',
        400,
        'INVALID_ROWS_BODY',
      );
    }
    return rows as PersistRowInput[];
  }

  private requireOriginalFilename(raw: unknown): string {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) {
      throw new DomainError(
        'original_filename is required',
        400,
        'ORIGINAL_FILENAME_REQUIRED',
      );
    }
    return trimmed;
  }

  // All-or-nothing: satu reviewer_note kepanjangan menolak seluruh persist (tak ada tulis
  // parsial), sama seperti ConfirmationService.submit's description check.
  private requireValidReviewerNotes(
    rows: PersistRowInput[],
  ): PersistRowInput[] {
    return rows.map((row, i) => {
      const check = validateFreeText(row.reviewer_note, {
        fieldLabel: `Catatan Reviewer (baris ${i + 1})`,
      });
      if (!check.ok) throw new DomainError(check.error, 400, check.code);
      return { ...row, reviewer_note: check.value };
    });
  }

  private async runPersist(
    client: PoolClient,
    params: {
      uploader: string;
      uploadedBy: string;
      period: string;
      originalFilename: string;
      description: string | null;
      rows: PersistRowInput[];
      file?: { buffer: Buffer; originalname: string; mimetype?: string };
      ip: string | null;
    },
  ): Promise<PersistResult> {
    const {
      uploader,
      uploadedBy,
      period,
      originalFilename,
      description,
      rows,
      file,
    } = params;

    // 1. Lock kandidat upload ACTIVE lama dinas+periode ini dulu, supaya dua persist
    // konkuren untuk pasangan yang sama tak bisa dua-duanya lolos block-check di bawah.
    const priorRes = await client.query<{ id: number }>(
      `SELECT id FROM rdt.uploads WHERE dinas_code=$1 AND period=$2 AND status='ACTIVE' FOR UPDATE`,
      [uploader, period],
    );
    const priorUploadIds = priorRes.rows.map((r) => r.id);
    let supersedeOutcome = {
      blocked: false,
      blockingCount: 0,
      blockingIds: [] as number[],
      supersedeIds: [] as number[],
    };
    if (priorUploadIds.length) {
      const priorTxnRes = await client.query<SupersedeCandidateRow>(
        `SELECT t.id, t.status_konfirmasi,
                EXISTS (SELECT 1 FROM rdt.ledger_entries le WHERE le.transaction_id = t.id) AS has_ledger_entry
         FROM rdt.transactions t WHERE t.upload_id = ANY($1)`,
        [priorUploadIds],
      );
      supersedeOutcome = evaluateSupersede(priorTxnRes.rows);
      if (supersedeOutcome.blocked) {
        throw new DomainError(
          `Upload sebelumnya untuk dinas ${uploader} periode ${period} (upload id ${priorUploadIds.join(', ')}) punya ${supersedeOutcome.blockingCount} transaksi yang sudah tercatat di ledger (CONFIRMED) — tidak bisa otomatis diganti. Tinjau/selesaikan transaksi tersebut secara manual dulu sebelum repost ulang periode ini. (blocking_transaction_ids=${supersedeOutcome.blockingIds.join(',')})`,
          409,
          'UPLOAD_SUPERSEDE_BLOCKED',
        );
      }
    }

    // 2. INSERT upload row.
    const upRes = await client.query<{ id: number }>(
      `INSERT INTO rdt.uploads (dinas_code, uploaded_by_user_id, original_filename, description, row_count_total, period)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        uploader,
        uploadedBy,
        originalFilename,
        description,
        rows.length,
        period,
      ],
    );
    const uploadId = upRes.rows[0].id;

    // 3. Supersede upload/transaksi lama (kalau ada & tak blocked).
    if (priorUploadIds.length) {
      await client.query(
        `UPDATE rdt.uploads SET status='SUPERSEDED', superseded_at=now(), superseded_by_upload_id=$1 WHERE id = ANY($2)`,
        [uploadId, priorUploadIds],
      );
      if (supersedeOutcome.supersedeIds.length) {
        await client.query(
          `UPDATE rdt.transactions SET status_konfirmasi='SUPERSEDED', updated_at=now() WHERE id = ANY($1)`,
          [supersedeOutcome.supersedeIds],
        );
      }
      await client.query(
        `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,NULL,$2,$3,$4,$5,$6)`,
        [
          uploadedBy,
          'UPLOAD_SUPERSEDED',
          'ACTIVE',
          'SUPERSEDED',
          JSON.stringify({
            dinas_inisiasi: uploader,
            period,
            prior_upload_ids: priorUploadIds,
            new_upload_id: uploadId,
            superseded_transaction_count: supersedeOutcome.supersedeIds.length,
          }),
          params.ip,
        ],
      );
    }

    // 4. Simpan file original (kalau ada) via StorageService -- bukan `fs` langsung.
    if (file) {
      const objectName = `uploads/${uploadId}-${sanitizeFilename(originalFilename || file.originalname)}`;
      await this.storage.putObject(objectName, file.buffer, file.mimetype);
      await client.query(
        'UPDATE rdt.uploads SET original_file_path=$1 WHERE id=$2',
        [objectName, uploadId],
      );
    }

    // 5. Duplicate check cross-upload (inert di Format CBO -- tak ada document_no, lihat 3.5a).
    const pendingDocNos = Array.from(
      new Set(
        rows
          .filter(
            (r) =>
              r.status_konfirmasi === RowStatus.PENDING &&
              r.document_no !== null &&
              r.document_no !== undefined &&
              // port apa adanya; document_no selalu string/number di praktiknya (tak pernah
              // dihasilkan parser Format CBO sama sekali, lihat komentar interface di atas).
              // eslint-disable-next-line @typescript-eslint/no-base-to-string
              String(r.document_no).trim() !== '',
          )
          .map((r) => String(r.document_no).trim()),
      ),
    );
    let existingRows: ExistingTransactionRow[] = [];
    if (pendingDocNos.length > 0) {
      const dupRes = await client.query<ExistingTransactionRow>(
        `SELECT id, upload_id, document_no, ref_doc, account, cost_ctr, profit_ctr, item, in_pclc, dinas_target
         FROM rdt.transactions WHERE document_no = ANY($1::text[])`,
        [pendingDocNos],
      );
      existingRows = dupRes.rows;
    }
    const rowsToInsert = flagDuplicates(rows, existingRows);

    // 6. Insert transaksi ter-chunk, semua chunk dalam transaksi yang sama (tetap atomik).
    const insertedRows: InsertedRow[] = [];
    for (let start = 0; start < rowsToInsert.length; start += CHUNK_SIZE) {
      const chunk = rowsToInsert.slice(start, start + CHUNK_SIZE);
      if (!chunk.length) continue;
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;
      for (const r of chunk) {
        const vals = rowValues(uploadId, r);
        values.push(...vals);
        placeholders.push(`(${vals.map(() => `$${idx++}`).join(',')})`);
      }
      const insertText = `INSERT INTO rdt.transactions(${INSERT_COLUMNS.join(',')}) VALUES ${placeholders.join(',')} RETURNING id, dinas_inisiasi, dinas_target`;
      const insertRes = await client.query<InsertedRow>(insertText, values);
      insertedRows.push(...insertRes.rows);
    }

    // 7. Deskripsi -> 1 komentar per dinas_target distinct (skip self-repost), lewat
    // PairCommentService (3c) -- bukan duplikasi logika comment/notif.
    if (description) {
      await this.postDescriptionComments(client, {
        uploader,
        uploadedBy,
        description,
        insertedRows,
      });
    }

    const duplicatesFlagged = rowsToInsert.filter(
      (r, i) =>
        r.status_konfirmasi === RowStatus.NEEDS_REVIEW &&
        rows[i].status_konfirmasi === RowStatus.PENDING,
    ).length;

    return {
      inserted: rowsToInsert.length,
      upload_id: uploadId,
      duplicates_flagged: duplicatesFlagged,
      superseded_upload_ids: priorUploadIds,
      superseded_transaction_count: supersedeOutcome.supersedeIds.length,
    };
  }

  private async postDescriptionComments(
    client: PoolClient,
    args: {
      uploader: string;
      uploadedBy: string;
      description: string;
      insertedRows: InsertedRow[];
    },
  ): Promise<void> {
    const { uploader, uploadedBy, description, insertedRows } = args;
    const pairTransactionId = new Map<string, number>();
    for (const r of insertedRows) {
      if (!r.dinas_target) continue;
      if (
        String(r.dinas_target).toUpperCase() ===
        String(r.dinas_inisiasi).toUpperCase()
      )
        continue;
      if (!pairTransactionId.has(r.dinas_target)) {
        pairTransactionId.set(r.dinas_target, r.id);
      }
    }
    for (const [dinasTarget, fallbackTransactionId] of pairTransactionId) {
      await this.pairComment.post(client, {
        dinasInisiasi: uploader,
        dinasTarget,
        implicitRecipientDinas: dinasTarget,
        fallbackTransactionId,
        authorUserId: uploadedBy,
        body: description,
      });
    }
  }

  // GET /repost/persist/uploads/:uploadId/download -- serve file original byte-for-byte.
  async downloadOriginal(
    uploadId: number,
    user: Identity,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { rows } = await this.db.query<{
      dinas_code: string;
      original_filename: string;
      original_file_path: string | null;
    }>(
      'SELECT dinas_code, original_filename, original_file_path FROM rdt.uploads WHERE id=$1',
      [uploadId],
    );
    if (!rows.length) {
      throw new DomainError('upload not found', 404, 'UPLOAD_NOT_FOUND');
    }
    const upload = rows[0];
    if (!upload.original_file_path) {
      throw new DomainError(
        'original file not available for this upload',
        404,
        'ORIGINAL_FILE_NOT_AVAILABLE',
      );
    }

    await this.authorizeDownload(uploadId, upload.dinas_code, user);

    const exists = await this.storage.objectExists(upload.original_file_path);
    if (!exists) {
      throw new DomainError(
        'original file missing on disk',
        404,
        'ORIGINAL_FILE_MISSING',
      );
    }
    const buffer = await this.storage.getObject(upload.original_file_path);
    return { buffer, filename: upload.original_filename };
  }

  // Otorisasi port faithful dari routes/uploads.js: TAB bebas; selain itu inisiator, ATAU
  // target SEKARANG, ATAU target LAMPAU (muncul sebagai from_dinas di audit REASSIGN/
  // REJECT_REDIRECT transaksi upload ini -- tanpa batas hop).
  private async authorizeDownload(
    uploadId: number,
    dinasCode: string,
    user: Identity,
  ): Promise<void> {
    if (user.role === 'TAB') return;
    const isInitiator =
      String(dinasCode).toUpperCase() === String(user.dinas).toUpperCase();
    if (isInitiator) return;

    const targetUpper = String(user.dinas).toUpperCase();
    const { rows: directRows } = await this.db.query(
      'SELECT 1 FROM rdt.transactions WHERE upload_id=$1 AND UPPER(dinas_target)=UPPER($2) LIMIT 1',
      [uploadId, user.dinas],
    );
    if (directRows.length) return;

    const { rows: chainRows } = await this.db.query(
      `SELECT 1 FROM rdt.audit_log a
       JOIN rdt.transactions t ON t.id = a.transaction_id
       WHERE t.upload_id = $1 AND a.action IN ('REASSIGN', 'REJECT_REDIRECT')
         AND UPPER(a.detail->>'from_dinas') = $2
       LIMIT 1`,
      [uploadId, targetUpper],
    );
    if (chainRows.length) return;

    throw new DomainError(
      `user ${user.userId} (dinas=${user.dinas}) not authorized to download upload ${uploadId}`,
      403,
      'FORBIDDEN_DOWNLOAD',
    );
  }
}
