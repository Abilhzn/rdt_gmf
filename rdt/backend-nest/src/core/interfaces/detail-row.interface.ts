import { RowStatus } from '../enums/row-status.enum';

/**
 * Satu baris hasil parse Format CBO — output `ExcelParserService`, jadi input `persist` (Batch
 * 3+). Port 1:1 dari shape `buildDetailRow` di `excelParser.js` lama.
 */
export interface DetailRow {
  sheet: string;
  row: number;
  dinas_inisiasi: string | null;
  account: unknown;
  profit_ctr: unknown;
  ref_doc: unknown;
  period: unknown;
  text_desc: unknown;
  material: unknown;
  in_pclc: unknown;
  curr: unknown;
  nominal: number | null;
  remark: unknown;
  category: unknown;
  dinas_target: string | null;
  reason_if_invalid: string | null;
  status_konfirmasi: RowStatus;
  raw_payload: Record<string, unknown>;
}
