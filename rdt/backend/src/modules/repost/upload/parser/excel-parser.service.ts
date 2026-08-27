import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { RowStatus } from '../../../../core/enums/row-status.enum';
import { DetailRow } from '../../../../core/interfaces/detail-row.interface';
import {
  DinasMappingSeed,
  ExclusionRulesSeed,
  loadDinasCodesSeed,
  loadExclusionsSeed,
  loadMappingSeed,
} from '../config/seed-config.loader';

export interface ParseOptions {
  uploaderDinas?: string | null;
  // Override hooks untuk Batch 2 (sumber DB) — default-nya seed file lokal (lihat
  // seed-config.loader.ts). Sengaja bukan flag boolean: caller yang menentukan sumbernya
  // sendiri lewat ada/tidaknya override, bukan lewat mode switch.
  mapping?: DinasMappingSeed;
  exclusions?: ExclusionRulesSeed;
  dinasCodes?: string[];
}

type ContractFieldKey =
  | 'account'
  | 'profit_ctr'
  | 'ref_doc'
  | 'period'
  | 'text_desc'
  | 'material'
  | 'in_pclc'
  | 'curr';

interface ContractFieldSpec {
  key: ContractFieldKey;
  variants: string[];
}

type ContractFieldValues = Record<ContractFieldKey, unknown>;

interface ResolvedSeeds {
  mapping: DinasMappingSeed;
  exclusions: ExclusionRulesSeed;
  dinasCodes: string[];
}

interface HeaderMap {
  // nama kolom (persis seperti di header row) -> daftar nomor kolom yang memakainya
  headerIndex: Record<string, number[]>;
  // nomor kolom -> nama kolom
  posName: Record<number, string>;
  maxCol: number;
}

interface AuxColumns {
  remarksCol?: number;
  detailGroupCol?: number;
  recipientCol?: number;
  requesterCol?: number;
}

/**
 * Port dari `rdt/backend/src/parser/excelParser.js` (Format CBO — satu-satunya format input
 * sejak rewrite 20 Agu, pivot-cache/kontrak 53-kolom lama sudah dibuang). Logika & angka HARUS
 * identik dengan versi lama — lihat `excel-parser.service.spec.ts` (port dari `test/parser.test.js`).
 *
 * ExcelJS dibungkus di sini (Boundaries, Clean Code Bab 8) — controller/module lain tidak pernah
 * import ExcelJS langsung.
 */
@Injectable()
export class ExcelParserService {
  // Requester/Recipient/Remarks/Detail Group dicari terpisah (di bawah) karena keduanya
  // menentukan dinas_inisiasi/dinas_target, bukan disimpan sebagai field transaksi biasa.
  private static readonly CONTRACT_FIELDS: ContractFieldSpec[] = [
    { key: 'account', variants: ['Account'] },
    { key: 'profit_ctr', variants: ['Profit Ctr', 'Profit Center'] },
    { key: 'ref_doc', variants: ['Ref.Doc.', 'Ref Doc', 'Ref.Doc'] },
    { key: 'period', variants: ['Period'] },
    { key: 'text_desc', variants: ['Text', 'Text Description', 'Text Desc'] },
    { key: 'material', variants: ['Material'] },
    { key: 'in_pclc', variants: ['In PCLC', 'InPCLC'] },
    { key: 'curr', variants: ['Curr.', 'Curr'] },
  ];

  /** Dipakai langsung terhadap file di disk — dipakai test (fixture di `rdt/contoh_input/`). */
  async parseFile(
    filePath: string,
    options: ParseOptions = {},
  ): Promise<DetailRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return this.parseWorkbook(workbook, options);
  }

  /** Dipakai controller — file datang dari `StorageService` sebagai Buffer (boundary storage). */
  async parseBuffer(
    buffer: Buffer,
    options: ParseOptions = {},
  ): Promise<DetailRow[]> {
    const workbook = new ExcelJS.Workbook();
    // exceljs pulls in a second, older @types/node (via fast-csv) whose ambient `Buffer` type
    // structurally clashes with ours — same runtime value, `any` bridges the duplicate-typings gap.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await workbook.xlsx.load(buffer as any);
    return this.parseWorkbook(workbook, options);
  }

  private parseWorkbook(
    workbook: ExcelJS.Workbook,
    options: ParseOptions,
  ): DetailRow[] {
    const seeds = this.resolveSeeds(options);
    const uploaderDinas = options.uploaderDinas ?? null;
    const results: DetailRow[] = [];

    workbook.eachSheet((worksheet) => {
      const header = this.buildHeaderMap(worksheet.getRow(1));
      if (!this.isFormatCboSheet(header)) return; // bukan sheet Format CBO — skip (mis. sheet referensi)

      const headerPos = this.locateContractColumns(header);
      const aux = this.locateAuxColumns(header.headerIndex);
      const coveredCols = new Set(
        [
          ...Object.values(headerPos),
          aux.remarksCol,
          aux.detailGroupCol,
          aux.recipientCol,
          aux.requesterCol,
        ].filter((c): c is number => !!c),
      );
      const lastCol = Math.max(header.maxCol, worksheet.columnCount || 0);

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // header
        results.push(
          this.buildRow({
            sheetName: worksheet.name,
            rowNumber,
            row,
            headerPos,
            aux,
            posName: header.posName,
            coveredCols,
            lastCol,
            seeds,
            uploaderDinas,
          }),
        );
      });
    });

    return results;
  }

  // ---- seed resolution -----------------------------------------------------------------

  private resolveSeeds(options: ParseOptions): ResolvedSeeds {
    return {
      mapping: options.mapping ?? loadMappingSeed(),
      exclusions: options.exclusions ?? loadExclusionsSeed(),
      dinasCodes: options.dinasCodes ?? loadDinasCodesSeed().codes ?? [],
    };
  }

  // ---- header discovery ------------------------------------------------------------------

  private buildHeaderMap(headerRow: ExcelJS.Row): HeaderMap {
    const headerIndex: Record<string, number[]> = {};
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      // Header cell values are always primitive text in practice (readCellValue already unwraps
      // rich-text/formula results) — eslint can't see that from `unknown`, same loose coercion
      // as the old JS parser.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const name = String(this.readCellValue(cell) ?? '').trim();
      if (!name) return;
      (headerIndex[name] ??= []).push(colNumber);
    });
    const posName: Record<number, string> = {};
    Object.keys(headerIndex).forEach((name) =>
      headerIndex[name].forEach((col) => (posName[col] = name)),
    );
    const maxCol = Math.max(0, ...Object.keys(posName).map(Number));
    return { headerIndex, posName, maxCol };
  }

  private isFormatCboSheet(header: HeaderMap): boolean {
    const headerNamesLower = new Set(
      Object.keys(header.headerIndex).map((h) => h.toLowerCase()),
    );
    const needed = ['Account', 'Profit Ctr', 'In PCLC', 'Recipient'];
    return needed.every((k) => headerNamesLower.has(k.toLowerCase()));
  }

  private locateContractColumns(
    header: HeaderMap,
  ): Partial<Record<ContractFieldKey, number>> {
    const headerPos: Partial<Record<ContractFieldKey, number>> = {};
    let scanCol = 1;
    for (const field of ExcelParserService.CONTRACT_FIELDS) {
      let found: number | undefined;
      for (let c = scanCol; c <= header.maxCol; c++) {
        const h = header.posName[c] || '';
        if (field.variants.some((v) => v.toLowerCase() === h.toLowerCase())) {
          found = c;
          scanCol = c + 1;
          break;
        }
      }
      headerPos[field.key] = found;
    }
    return headerPos;
  }

  private locateAuxColumns(headerIndex: Record<string, number[]>): AuxColumns {
    const findCol = (
      matchFn: (nameLower: string) => boolean,
    ): number | undefined => {
      for (const name of Object.keys(headerIndex)) {
        if (matchFn(name.toLowerCase())) return headerIndex[name][0];
      }
      return undefined;
    };
    return {
      remarksCol: findCol((n) => n.startsWith('remark')),
      detailGroupCol: findCol((n) => n === 'detail group'),
      recipientCol: findCol((n) => n === 'recipient'),
      requesterCol: findCol((n) => n === 'requester'),
    };
  }

  // ---- per-row construction ---------------------------------------------------------------

  private buildRow(ctx: {
    sheetName: string;
    rowNumber: number;
    row: ExcelJS.Row;
    headerPos: Partial<Record<ContractFieldKey, number>>;
    aux: AuxColumns;
    posName: Record<number, string>;
    coveredCols: Set<number>;
    lastCol: number;
    seeds: ResolvedSeeds;
    uploaderDinas: string | null;
  }): DetailRow {
    const fieldValues = this.extractFieldValues(ctx.row, ctx.headerPos);
    const remark = ctx.aux.remarksCol
      ? this.readCellValue(ctx.row.getCell(ctx.aux.remarksCol))
      : null;
    const category = ctx.aux.detailGroupCol
      ? this.readCellValue(ctx.row.getCell(ctx.aux.detailGroupCol))
      : null;
    const recipientRaw = ctx.aux.recipientCol
      ? this.readCellValue(ctx.row.getCell(ctx.aux.recipientCol))
      : null;
    const requesterRaw = ctx.aux.requesterCol
      ? this.readCellValue(ctx.row.getCell(ctx.aux.requesterCol))
      : null;
    const rawPayload = this.buildRawPayload(
      ctx.row,
      ctx.posName,
      ctx.coveredCols,
      ctx.lastCol,
    );

    const nominal = this.parseNumber(fieldValues.in_pclc);
    // Truthy check (bukan null/undefined check) disengaja — persis kode lama: recipientRaw="" atau
    // 0 juga jadi null di sini, bukan string kosong.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const recipient = recipientRaw ? String(recipientRaw).trim() : null;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const requester = requesterRaw ? String(requesterRaw).trim() : null;

    // "Ask TA" bukan dinas — sinyal baris perlu investigasi manual TAB (beda dari NEEDS_REVIEW
    // "kode tak dikenal"). Perbandingan case-sensitive, persis seperti kode lama.
    const isAskTaInvestigation = recipient === 'Ask TA';
    const dinasTarget = this.resolveDinasTarget(
      recipient,
      isAskTaInvestigation,
      ctx.seeds,
    );
    const { status, reasonIfInvalid } = this.resolveStatus({
      nominal,
      recipient,
      requester,
      uploaderDinas: ctx.uploaderDinas,
      exclusions: ctx.seeds.exclusions,
      isAskTaInvestigation,
      dinasTarget,
    });

    return {
      sheet: ctx.sheetName,
      row: ctx.rowNumber,
      dinas_inisiasi: ctx.uploaderDinas,
      account: fieldValues.account,
      profit_ctr: fieldValues.profit_ctr,
      ref_doc: fieldValues.ref_doc,
      period: fieldValues.period,
      text_desc: fieldValues.text_desc,
      material: fieldValues.material,
      in_pclc: fieldValues.in_pclc,
      curr: fieldValues.curr,
      nominal,
      remark,
      category,
      dinas_target: dinasTarget,
      reason_if_invalid: reasonIfInvalid,
      status_konfirmasi: status,
      raw_payload: rawPayload,
    };
  }

  private extractFieldValues(
    row: ExcelJS.Row,
    headerPos: Partial<Record<ContractFieldKey, number>>,
  ): ContractFieldValues {
    const values = {} as ContractFieldValues;
    for (const field of ExcelParserService.CONTRACT_FIELDS) {
      const col = headerPos[field.key];
      values[field.key] = col ? this.readCellValue(row.getCell(col)) : null;
    }
    return values;
  }

  private buildRawPayload(
    row: ExcelJS.Row,
    posName: Record<number, string>,
    coveredCols: Set<number>,
    lastCol: number,
  ): Record<string, unknown> {
    const rawPayload: Record<string, unknown> = {};
    for (let c = 1; c <= lastCol; c++) {
      if (coveredCols.has(c)) continue;
      rawPayload[posName[c] || `col_${c}`] = this.readCellValue(row.getCell(c));
    }
    return rawPayload;
  }

  // ---- dinas_target resolution -------------------------------------------------------------

  private resolveDinasTarget(
    recipient: string | null,
    isAskTaInvestigation: boolean,
    seeds: ResolvedSeeds,
  ): string | null {
    if (isAskTaInvestigation || !recipient) return null;
    const { mapping } = seeds;
    const mapped =
      mapping[recipient] ||
      mapping[recipient.toLowerCase()] ||
      mapping[recipient.toUpperCase()];
    if (mapped) return mapped;
    const allowedCodes = this.buildAllowedCodes(seeds);
    return allowedCodes.get(recipient.toUpperCase()) ?? null;
  }

  // Codes a raw Recipient value can resolve to without an explicit mapping.seed.json entry —
  // mapping's own keys+values plus the full canonical dinas roster. Returns UPPERCASE key -> the
  // ORIGINAL casing (dinas 'Corp' is stored mixed-case in rdt.dinas; uppercasing before insert
  // would violate the dinas_target FK).
  private buildAllowedCodes(seeds: ResolvedSeeds): Map<string, string> {
    const map = new Map<string, string>();
    Object.keys(seeds.mapping).forEach((k) =>
      map.set(String(seeds.mapping[k]).toUpperCase(), String(seeds.mapping[k])),
    );
    Object.values(seeds.mapping).forEach((v) =>
      map.set(String(v).toUpperCase(), String(v)),
    );
    seeds.dinasCodes.forEach((c) =>
      map.set(String(c).toUpperCase(), String(c)),
    );
    return map;
  }

  // ---- status resolution ------------------------------------------------------------------

  private isExcludedRow(params: {
    recipient: string | null;
    requester: string | null;
    uploaderDinas: string | null;
    exclusions: ExclusionRulesSeed;
  }): boolean {
    const { recipient, requester, uploaderDinas, exclusions } = params;
    if (
      recipient &&
      requester &&
      recipient.toUpperCase() === requester.toUpperCase()
    )
      return true;
    if (
      recipient &&
      uploaderDinas &&
      recipient.toUpperCase() === uploaderDinas.toUpperCase()
    )
      return true;
    if (recipient && exclusions.prefixes.includes(recipient)) return true;
    return false;
  }

  private resolveStatus(params: {
    nominal: number | null;
    recipient: string | null;
    requester: string | null;
    uploaderDinas: string | null;
    exclusions: ExclusionRulesSeed;
    isAskTaInvestigation: boolean;
    dinasTarget: string | null;
  }): { status: RowStatus; reasonIfInvalid: string | null } {
    let status: RowStatus = this.isExcludedRow(params)
      ? RowStatus.EXCLUDED
      : RowStatus.PENDING;
    // Ditangkap SEBELUM overwrite INVALID di bawah — dipakai lagi di cabang NEEDS_REVIEW supaya
    // baris yang tadinya EXCLUDED tidak pernah ketiban NEEDS_REVIEW meski Recipient-nya juga
    // gagal resolve (mis. prefix exclusion seperti "AUAK" memang bukan kode dinas).
    const preResolvedExcluded = status === RowStatus.EXCLUDED;

    // Nominal tak terbaca menang atas apapun yang dihitung di atas — termasuk EXCLUDED (persis
    // perilaku excelParser.js lama, disengaja bukan bug).
    if (params.nominal === null || Number.isNaN(params.nominal)) {
      status = RowStatus.INVALID;
    }

    let reasonIfInvalid: string | null = null;
    if (params.isAskTaInvestigation) {
      if (status === RowStatus.PENDING) status = RowStatus.NEEDS_INVESTIGATION;
    } else if (
      params.recipient &&
      !params.dinasTarget &&
      !preResolvedExcluded
    ) {
      status = RowStatus.NEEDS_REVIEW;
      reasonIfInvalid = `Unknown Recipient: ${params.recipient}`;
    } else if (
      !params.recipient &&
      status !== RowStatus.INVALID &&
      !preResolvedExcluded
    ) {
      status = RowStatus.NEEDS_REVIEW;
      reasonIfInvalid =
        'Missing Recipient — tidak bisa menentukan dinas target';
    }

    return { status, reasonIfInvalid };
  }

  // ---- cell/value helpers -----------------------------------------------------------------

  /** Preferensi hasil formula ter-cache kalau ada; menangani rich text ExcelJS juga. */
  private readCellValue(cell: ExcelJS.Cell | undefined): unknown {
    if (!cell) return null;
    const v = cell.value;
    if (v && typeof v === 'object' && 'result' in v)
      return (v as { result: unknown }).result;
    if (v && typeof v === 'object' && (v as { text?: unknown }).text)
      return (v as { text: unknown }).text;
    return v;
  }

  private parseNumber(val: unknown): number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return val;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const s = String(val).trim();
    // format Eropa, mis. "5.926,66"
    const euro = /^[-+]?[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]+$/.exec(s);
    if (euro) return Number(s.replace(/\./g, '').replace(',', '.'));
    const plain = s.replace(/,/g, '');
    const n = Number(plain);
    return Number.isNaN(n) ? null : n;
  }
}
