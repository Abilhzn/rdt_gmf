-- ============================================================
-- RDT (Repost Detail Transaksi) — PostgreSQL schema  v2
-- Perubahan besar dari v1 (sinkron dengan flowchart & konsep UI 20 Jul):
--   1. transactions memuat SELURUH 53 kolom kontrak file Excel
--      (Account s/d Value Date) — bukan subset lagi.
--   2. Status baru: konfirmasi = klaim kepemilikan (CONFIRMED/DECLINED),
--      DECLINED bisa ditanggung pengaju (BORNE_BY_INITIATOR) atau
--      di-reassign ke dinas lain (kembali PENDING + jejak reassignment).
--   3. Tabel export_batches: approval final Senior Manager + Group Head
--      dinas TA sebelum export SAP.
-- Kolom *_user_id bertipe text merujuk tabel karyawan tim IT (tanpa FK,
-- nama tabel masih open question). JANGAN buat tabel user baru.
--
-- Skema ini SUDAH diterapkan ke rdt_dev — perubahan setelah titik ini ditulis
-- sebagai file terpisah di sql/migrations/ (dijalankan berurutan oleh
-- src/migrate.js), BUKAN dengan mengedit file ini secara retroaktif.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS rdt;

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rdt.dinas (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rdt.uploads (
  id                  bigserial PRIMARY KEY,
  dinas_code          text NOT NULL REFERENCES rdt.dinas(code),
  uploaded_by_user_id text NOT NULL,
  original_filename   text NOT NULL,
  period              text,
  description         text,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  row_count_total     integer,
  row_count_pending   integer,
  row_count_excluded  integer,
  row_count_invalid   integer
);
-- ALTER, not just CREATE ... IF NOT EXISTS, so this column reaches installs where the
-- uploads table already existed before "description" was added (item 6, optional Repost note).
ALTER TABLE rdt.uploads ADD COLUMN IF NOT EXISTS description text;

-- ------------------------------------------------------------
-- Transaksi: 53 kolom kontrak Excel dipetakan 1:1 (snake_case).
-- Penyesuaian nama karena reserved word / duplikat header:
--   "User"->sap_user, "Order"->order_no, "Text"->text_desc,
--   "Year"(kolom 15)->fiscal_year, "Year"(kolom 23)->year_2,
--   "Obj. class"/"ObjCl"->obj_class (dua varian header, satu kolom).
-- Kolom variabel per dinas SETELAH Value Date tetap di raw_payload.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rdt.transactions (
  id                bigserial PRIMARY KEY,
  upload_id         bigint NOT NULL REFERENCES rdt.uploads(id),
  dinas_inisiasi    text NOT NULL REFERENCES rdt.dinas(code),
  dinas_target      text REFERENCES rdt.dinas(code),
  nominal           numeric(18,2) NOT NULL,   -- nilai terproses (dari in_pclc)
  category          text,                     -- hasil mapping GL
  is_reversal       boolean NOT NULL DEFAULT false,
  status_konfirmasi text NOT NULL DEFAULT 'PENDING'
    CHECK (status_konfirmasi IN (
      'PENDING',            -- menunggu klaim dinas target
      'CONFIRMED',          -- dinas target: "ya, milik kami"
      'DECLINED',           -- dinas target: "bukan milik kami"
      'BORNE_BY_INITIATOR', -- declined, ditanggung dinas pengaju
      'EXCLUDED',           -- internal/AUAK/PO — bukan tagihan lintas dinas
      'INVALID',            -- gagal validasi parser
      'NEEDS_REVIEW'        -- prefix tak dikenal, perlu keputusan manual
    )),
  invalid_reason    text,
  -- jejak reassignment (DECLINED -> diajukan ulang ke dinas lain)
  reassigned_from   text REFERENCES rdt.dinas(code),
  reassign_count    integer NOT NULL DEFAULT 0,
  -- ---------- 53 kolom kontrak Excel (urut sesuai file) ----------
  account       text,          -- 1  Account
  cost_ctr      text,          -- 2  Cost Ctr
  profit_ctr    text,          -- 3  Profit Ctr
  partner_pc    text,          -- 4  Partner PC
  document_no   text,          -- 5  DocumentNo
  ref_doc       text,          -- 6  Ref.Doc.
  period        text,          -- 7  Period
  text_desc     text,          -- 8  Text
  acc_text      text,          -- 9  Acc.Text
  sap_user      text,          -- 10 User
  sales_doc     text,          -- 11 Sales Doc.
  wbs_elem      text,          -- 12 WBS Elem.
  purch_doc     text,          -- 13 Purch.Doc.
  order_no      text,          -- 14 Order
  fiscal_year   text,          -- 15 Year
  elim_prctr    text,          -- 16 Elim.PrCtr
  obj_class     text,          -- 17 Obj. class / ObjCl
  customer      text,          -- 18 Customer
  vendor        text,          -- 19 Vendor
  plant         text,          -- 20 Plant
  material      text,          -- 21 Material
  time_val      text,          -- 22 Time
  year_2        text,          -- 23 Year (duplikat header ke-2)
  ref_org_un    text,          -- 24 Ref.Org Un
  val_a         text,          -- 25 ValA
  mvt           text,          -- 26 MvT
  type          text,          -- 27 Type
  sales_ord     text,          -- 28 Sales Ord.
  s_no          text,          -- 29 SNo.
  bus_a         text,          -- 30 BusA
  func_area     text,          -- 31 Func. Area
  acty          text,          -- 32 Acty
  asset         text,          -- 33 Asset
  rep_mat       text,          -- 34 Rep. mat.
  ar            text,          -- 35 Ar.
  dt            text,          -- 36 DT
  ref_tran      text,          -- 37 Ref. Tran.
  item          text,          -- 38 Item
  bill_t        text,          -- 39 BillT
  sd_doc        text,          -- 40 SD Doc.
  s_grp         text,          -- 41 SGrp
  s_off         text,          -- 42 SOff.
  co_ar         text,          -- 43 COAr
  in_pclc       numeric(18,2), -- 44 In PCLC (nilai mentah)
  curr          text,          -- 45 Curr.
  doc_date      date,          -- 46 Doc. Date
  pstng_date    date,          -- 47 Pstng Date
  in_ccc        numeric(18,2), -- 48 In CCC
  in_tc         numeric(18,2), -- 49 In TC
  qty           numeric(18,3), -- 50 Qty
  unit          text,          -- 51 Unit
  entry_dte     date,          -- 52 Entry Dte
  value_date    date,          -- 53 Value Date
  -- ---------------------------------------------------------------
  sheet_name        text,
  raw_row_index     integer,
  remark            text,      -- kolom Remark/Remarks (variabel, dipakai logika)
  raw_payload       jsonb,     -- kolom variabel per dinas setelah Value Date
  decided_by_user_id text,
  decided_at         timestamptz,
  export_batch_id   bigint,    -- diisi saat masuk batch export (FK di bawah)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_txn_target_status
  ON rdt.transactions (dinas_target, status_konfirmasi);
CREATE INDEX IF NOT EXISTS idx_txn_upload  ON rdt.transactions (upload_id);
CREATE INDEX IF NOT EXISTS idx_txn_status  ON rdt.transactions (status_konfirmasi);
CREATE INDEX IF NOT EXISTS idx_txn_batch   ON rdt.transactions (export_batch_id);

-- ------------------------------------------------------------
-- Approval final + export SAP (level batch, bukan per baris).
-- Alur (disederhanakan 24 Jul 2026, koreksi project owner — role SM_TA/GH_TA dihapus,
-- semua approval cukup lewat role TAB): batch dibuat dari transaksi berstatus final ->
-- approval TAB (sekali, bukan berjenjang) -> export.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rdt.export_batches (
  id                  bigserial PRIMARY KEY,
  period              text NOT NULL,
  created_by_user_id  text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  approved_by_user_id text,        -- role TAB
  approved_at         timestamptz,
  exported_at         timestamptz,
  export_filename     text,
  status              text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','WAITING_APPROVAL','APPROVED','EXPORTED','CANCELLED'))
);

ALTER TABLE rdt.transactions
  DROP CONSTRAINT IF EXISTS fk_txn_export_batch;
ALTER TABLE rdt.transactions
  ADD CONSTRAINT fk_txn_export_batch
  FOREIGN KEY (export_batch_id) REFERENCES rdt.export_batches(id);

-- ------------------------------------------------------------
-- Double-entry ledger: 2 baris (DEBIT+CREDIT) per transaksi CONFIRMED,
-- ditulis dalam SATU transaksi DB yang sama dengan update status.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rdt.ledger_entries (
  id             bigserial PRIMARY KEY,
  transaction_id bigint NOT NULL REFERENCES rdt.transactions(id),
  dinas_code     text NOT NULL REFERENCES rdt.dinas(code),
  direction      text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount         numeric(18,2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_dinas ON rdt.ledger_entries (dinas_code);
CREATE INDEX IF NOT EXISTS idx_ledger_txn   ON rdt.ledger_entries (transaction_id);

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rdt.dinas_mapping (
  prefix             text PRIMARY KEY,
  dinas_code         text NOT NULL REFERENCES rdt.dinas(code),
  updated_by_user_id text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rdt.exclusion_rules (
  prefix             text PRIMARY KEY,
  reason             text,
  updated_by_user_id text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rdt.comments (
  id                bigserial PRIMARY KEY,
  transaction_id    bigint NOT NULL REFERENCES rdt.transactions(id),
  parent_comment_id bigint REFERENCES rdt.comments(id),
  author_user_id    text NOT NULL,
  body              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_txn ON rdt.comments (transaction_id);

CREATE TABLE IF NOT EXISTS rdt.audit_log (
  id             bigserial PRIMARY KEY,
  user_id        text NOT NULL,
  transaction_id bigint REFERENCES rdt.transactions(id),
  action         text NOT NULL,
    -- 'UPLOAD','CONFIRM','DECLINE','BEAR_BY_INITIATOR','REASSIGN',
    -- 'SM_APPROVE','GH_APPROVE','EXPORT_SAP','ROLLBACK',
    -- 'MAPPING_CHANGE','EXCLUSION_CHANGE'
  status_before  text,
  status_after   text,
  ip_address     inet,
  detail         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_txn  ON rdt.audit_log (transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON rdt.audit_log (user_id);

-- ============================================================
-- SEED
-- ============================================================
-- 'TA' the LOGIN identity was retired and merged into 'TAB' (whoever could log in for dinas TA
-- was already TAB staff — same entity, no separate demo-ta login in employee-directory.seed.json).
-- That is NOT the same thing as the dinas_target VALUE — 'TA' stays a real, distinct dinas_target
-- (project owner correction, 28 Jul 2026, after a prior session briefly resolved it to 'TAB' and
-- broke transactions_dinas_target_fkey on a real repost, since TAB deliberately has no row here).
-- TAB itself is deliberately NOT seeded here — it's the administrative division running RDT, not
-- an operational dinas that receives repost transactions from Excel data — role TAB's dinas="TAB"
-- doesn't need a rdt.dinas row to work (requireDinasAccess compares strings, no FK), and TAB
-- shouldn't appear as a REASSIGN target choice (see reassignment.js's dinas picker, sourced from
-- this table). 'TA', like 'Corp', has no dedicated PIC — only role TAB confirms its queue (same
-- REQ-RDT-AUTH-04 pattern, see auth.js + dashboard.js's targetDinasCodes).
--
-- Full 21-dinas roster (2026-07-22 fix): previously only 7 of the 21 operational dinas were
-- seeded here, while employee-directory.seed.json already had PIC logins for all 21 — any
-- transaction targeting one of the other 14 would have failed on the dinas_target FK the
-- moment it was inserted. Every dinas below has (or will have) its own PIC login except TA/Corp,
-- the two target values with no dedicated PIC (handled by role TAB, see auth.js comment).
INSERT INTO rdt.dinas (code, name) VALUES
  ('TA','Dinas TA'),
  ('TB','Dinas TB'), ('TC','Dinas TC'), ('TD','Dinas TD'), ('TE','Dinas TE'),
  ('TF','Dinas TF'), ('TG','Dinas TG'), ('TH','Dinas TH'), ('TI','Dinas TI'),
  ('TJ','Dinas TJ'), ('TK','Dinas TK'), ('TL','Dinas TL'), ('TM','Dinas TM'),
  ('TN','Dinas TN'), ('TO','Dinas TO'), ('TP','Dinas TP'), ('TQ','Dinas TQ'),
  ('TR','Dinas TR'), ('TS','Dinas TS'), ('TT','Dinas TT'), ('TU','Dinas TU'),
  ('Corp','Corporate')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rdt.dinas_mapping (prefix, dinas_code) VALUES
  ('TCR','TC'), ('TJ Plant','TJ')
ON CONFLICT (prefix) DO NOTHING;

INSERT INTO rdt.exclusion_rules (prefix, reason) VALUES
  ('AUAK','Kategori internal, bukan tagihan lintas dinas'),
  ('PO','Purchase order internal, bukan tagihan lintas dinas')
ON CONFLICT (prefix) DO NOTHING;
