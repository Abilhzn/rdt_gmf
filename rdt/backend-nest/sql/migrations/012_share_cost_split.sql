-- Section 3.10 (Share-Cost oleh TAB, "seadanya" version, asumsi dikunci 3 Agu): TAB bisa
-- membelah satu baris PENDING jadi beberapa baris dengan dinas_target/nominal berbeda. Baris
-- asli ditandai SPLIT_VOID (tidak dihitung di agregasi manapun -- semua query yang enumerate
-- status_konfirmasi harus TIDAK menyertakan SPLIT_VOID di jalur aktif), baris hasil split baru
-- berstatus PENDING seperti biasa dengan split_from_transaction_id menunjuk baris asli.

ALTER TABLE rdt.transactions DROP CONSTRAINT IF EXISTS transactions_status_konfirmasi_check;
ALTER TABLE rdt.transactions
  ADD CONSTRAINT transactions_status_konfirmasi_check
  CHECK (status_konfirmasi IN (
    'PENDING',
    'CONFIRMED',
    'DECLINED',
    'BORNE_BY_INITIATOR',
    'EXCLUDED',
    'INVALID',
    'NEEDS_REVIEW',
    'NEEDS_INVESTIGATION',
    'SPLIT_VOID'
  ));

ALTER TABLE rdt.transactions ADD COLUMN IF NOT EXISTS split_from_transaction_id bigint REFERENCES rdt.transactions(id);
CREATE INDEX IF NOT EXISTS idx_txn_split_from ON rdt.transactions (split_from_transaction_id);
