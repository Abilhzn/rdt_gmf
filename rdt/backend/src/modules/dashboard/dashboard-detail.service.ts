import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../core/database/database.service';
import { DIRECTORY_PROVIDER } from '../../core/directory/directory.interface';
import type { DirectoryProvider } from '../../core/directory/directory.interface';
import { DomainError } from '../../core/errors/domain-error';
import type { Identity } from '../../core/security/identity.interface';
import { validateFreeText } from '../../core/utils/text-validation';
import {
  filterMentionsToPair,
  resolveMentionedUserIds,
} from '../repost/rules/mention-rules';
import { RollbackAuditService } from '../repost/shared/rollback-audit.service';
import { RESOLVED_STATUSES } from './dashboard.constants';
import {
  canAccessPair,
  getPairCommentThread,
  getPairTransactions,
  PairComment,
  PairTransactionRow,
} from './shared/dashboard-detail-helpers';

export interface PairProgress {
  dinas: string;
  total: number;
  resolved: number;
  open: number;
  declined_pending_action: number;
  percent: number;
  chain?: string[];
}

export interface PairDetail {
  initiator_dinas: string;
  target_dinas: string;
  progress: PairProgress;
  transactions: PairTransactionRow[];
  comments: PairComment[];
}

export interface PostedComment {
  id: number;
  transaction_id: number;
  parent_comment_id: number | null;
  author_user_id: string;
  author_display_name: string;
  body: string;
  created_at: Date | string;
}

export interface PostCommentResult {
  comment: PostedComment;
  notified: string[];
}

/**
 * `dashboard/detail` — port `GET/POST /detail/:initiatorDinas/:targetDinas[/comments]`
 * (Batch 5c, penutup dashboard). Akses dua-sisi (`canAccessPair`): PIC inisiator ATAU target
 * pasangan itu, atau TAB.
 *
 * ⚠️ Comment di sini pakai pola KETIGA-nya sendiri (beda dari `PairCommentService` 3c yang
 * reply-kalau-ada-root, DAN beda dari export confirm 4b yang selalu top-level baru): reply KALAU
 * `parent_comment_id` diberi eksplisit (inherit `transaction_id` parent, bukan dari body),
 * TANPA itu -> top-level baru, anchor ke transaksi ber-id TERBESAR pasangan itu. JANGAN panggil
 * `PairCommentService.post()` di sini -- behaviornya beda sengaja.
 */
@Injectable()
export class DashboardDetailService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rollbackAudit: RollbackAuditService,
    @Inject(DIRECTORY_PROVIDER) private readonly directory: DirectoryProvider,
  ) {}

  private assertAccess(
    user: Identity,
    initiatorDinas: string,
    targetDinas: string,
  ): void {
    if (!canAccessPair(user, initiatorDinas, targetDinas)) {
      throw new DomainError(
        `user ${user.userId} not authorized for pair ${initiatorDinas}->${targetDinas}`,
        403,
        'FORBIDDEN_PAIR_ACCESS',
      );
    }
  }

  // GET dashboard/detail/:initiatorDinas/:targetDinas
  async getDetail(
    user: Identity,
    initiatorDinas: string,
    targetDinas: string,
  ): Promise<PairDetail> {
    this.assertAccess(user, initiatorDinas, targetDinas);
    const transactions = await getPairTransactions(
      this.db,
      initiatorDinas,
      targetDinas,
    );

    // Progress dihitung LANGSUNG dari `transactions` di sini -- BUKAN reuse
    // `buildChainAwareProgress` privat 5b, karena pasangan yang dicapai lewat redirect tak akan
    // match key agregat 5b yang sudah di-collapse ke target original.
    const total = transactions.length;
    const resolved = transactions.filter((t) =>
      RESOLVED_STATUSES.includes(t.status_konfirmasi),
    ).length;
    const pending = transactions.filter(
      (t) => t.status_konfirmasi === 'PENDING',
    ).length;
    const declined = transactions.filter(
      (t) => t.status_konfirmasi === 'DECLINED',
    ).length;

    // Badge breadcrumb header butuh field `chain` yang sama seperti kartu Dashboard (5b), walau
    // endpoint ini bangun `progress`-nya sendiri langsung dari `transactions`. Tiap transaksi
    // sudah bawa `chain` penuhnya sendiri (getPairTransactions) -- aturan "expose cuma kalau
    // semua anggota sepakat" yang sama berlaku di sini juga.
    const chainStrings = transactions.map((t) => JSON.stringify(t.chain));
    const chainConsistent =
      chainStrings.length > 0 &&
      chainStrings.every((c) => c === chainStrings[0]);
    const firstChain = transactions[0]?.chain;
    const chain =
      chainConsistent && firstChain && firstChain.length > 2
        ? firstChain
        : undefined;

    const progress: PairProgress = {
      dinas: targetDinas,
      total,
      resolved,
      open: pending,
      declined_pending_action: declined,
      percent: total > 0 ? Math.round((resolved / total) * 1000) / 10 : 0,
      chain,
    };

    const directory = await this.directory.load();
    const comments = await getPairCommentThread(
      this.db,
      transactions.map((t) => Number(t.id)),
      directory,
    );

    return {
      initiator_dinas: initiatorDinas,
      target_dinas: targetDinas,
      progress,
      transactions,
      comments,
    };
  }

  // GET dashboard/detail/:initiatorDinas/:targetDinas/comments -- versi ringan (polling).
  async getComments(
    user: Identity,
    initiatorDinas: string,
    targetDinas: string,
  ): Promise<{ comments: PairComment[] }> {
    this.assertAccess(user, initiatorDinas, targetDinas);
    const transactions = await getPairTransactions(
      this.db,
      initiatorDinas,
      targetDinas,
    );
    const directory = await this.directory.load();
    const comments = await getPairCommentThread(
      this.db,
      transactions.map((t) => Number(t.id)),
      directory,
    );
    return { comments };
  }

  // POST dashboard/detail/:initiatorDinas/:targetDinas/comments
  async postComment(args: {
    user: Identity;
    initiatorDinas: string;
    targetDinas: string;
    rawBody: unknown;
    rawParentCommentId: unknown;
    ip: string | null;
  }): Promise<PostCommentResult> {
    const {
      user,
      initiatorDinas,
      targetDinas,
      rawBody,
      rawParentCommentId,
      ip,
    } = args;
    this.assertAccess(user, initiatorDinas, targetDinas);

    // Pra-transaksi: body wajib, JANGAN buka transaksi kalau gagal.
    const bodyCheck = validateFreeText(rawBody, {
      required: true,
      fieldLabel: 'body',
    });
    if (!bodyCheck.ok) {
      throw new DomainError(bodyCheck.error, 400, bodyCheck.code);
    }
    const body = bodyCheck.value;
    if (!body) {
      // Tak akan pernah tercapai (required:true di atas sudah menjamin ini), tapi menjaga tipe
      // tetap `string` tanpa non-null assertion.
      throw new DomainError('body wajib diisi', 400, 'REQUIRED');
    }
    const parentCommentId = rawParentCommentId
      ? Number(rawParentCommentId)
      : null;

    try {
      return await this.db.withTransaction((client) =>
        this.runPostComment(client, {
          initiatorDinas,
          targetDinas,
          body,
          parentCommentId,
          userId: user.userId,
        }),
      );
    } catch (err) {
      throw await this.wrapRollback(err, user.userId, ip);
    }
  }

  private async runPostComment(
    client: PoolClient,
    params: {
      initiatorDinas: string;
      targetDinas: string;
      body: string;
      parentCommentId: number | null;
      userId: string;
    },
  ): Promise<PostCommentResult> {
    const { initiatorDinas, targetDinas, body, parentCommentId, userId } =
      params;

    let transactionId: number;
    if (parentCommentId) {
      const { rows } = await client.query<{ transaction_id: number }>(
        'SELECT transaction_id FROM rdt.comments WHERE id=$1',
        [parentCommentId],
      );
      if (!rows.length) {
        throw new DomainError(
          `parent_comment_id ${parentCommentId} not found`,
          400,
          'PARENT_COMMENT_NOT_FOUND',
        );
      }
      transactionId = Number(rows[0].transaction_id);
    } else {
      const transactions = await getPairTransactions(
        client,
        initiatorDinas,
        targetDinas,
      );
      if (!transactions.length) {
        throw new DomainError(
          `no transactions exist yet for pair ${initiatorDinas}->${targetDinas} to anchor a comment to`,
          400,
          'NO_TRANSACTIONS_FOR_PAIR',
        );
      }
      transactionId = transactions.reduce(
        (max, t) => (Number(t.id) > max ? Number(t.id) : max),
        Number(transactions[0].id),
      );
    }

    const insertRes = await client.query<{
      id: number;
      created_at: Date | string;
    }>(
      `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [transactionId, parentCommentId || null, userId, body],
    );
    const commentId = Number(insertRes.rows[0].id);

    // Murni notify-only, tak ada efek samping transaksi/reassignment. Mention dinas DI LUAR
    // pasangan ini tak boleh bocor notifikasi yang mengungkap keberadaan pasangan ini -- lihat
    // mentionRules.js's filterMentionsToPair.
    const directory = await this.directory.load();
    const mentionedUserIds = filterMentionsToPair(
      resolveMentionedUserIds(body, directory),
      directory,
      [initiatorDinas, targetDinas],
    ).filter((id) => id !== userId);
    for (const recipientId of mentionedUserIds) {
      await client.query(
        'INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)',
        [recipientId, commentId],
      );
    }

    return {
      comment: {
        id: commentId,
        transaction_id: transactionId,
        parent_comment_id: parentCommentId || null,
        author_user_id: userId,
        author_display_name: directory[userId]?.display_name ?? userId,
        body,
        created_at: insertRes.rows[0].created_at,
      },
      notified: mentionedUserIds,
    };
  }

  // Pola sama seperti PersistService/ExportConfirmService/ExportSubdocService.wrapRollback.
  private async wrapRollback(
    err: unknown,
    userId: string,
    ip: string | null,
  ): Promise<DomainError> {
    const category = await this.rollbackAudit.record({
      userId,
      ip,
      err,
      route: 'dashboard/detail/:initiatorDinas/:targetDinas/comments',
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
    return new DomainError(message, 500, 'DASHBOARD_COMMENT_FAILED', category);
  }
}
