/**
 * Format CBO — satu-satunya format input sejak rewrite 20 Agu (pivot-cache/kontrak 53-kolom
 * lama sudah dibuang). 12 kolom di template resmi (`Format_Detail_Transaksi.xlsx`):
 * Requester, Account, Detail Group, Profit Ctr, Ref.Doc., Period, Text, Material, In PCLC,
 * Curr., Remarks, Recipient. Nilai per baris masih longgar tipenya (apa adanya dari cell Excel)
 * — normalisasi (angka, dsb) terjadi belakangan di `ExcelParserService`.
 */
export interface FormatCboRow {
  requester: string | null;
  account: unknown;
  detailGroup: unknown;
  profitCtr: unknown;
  refDoc: unknown;
  period: unknown;
  text: unknown;
  material: unknown;
  inPclc: unknown;
  curr: unknown;
  remarks: unknown;
  recipient: string | null;
}
