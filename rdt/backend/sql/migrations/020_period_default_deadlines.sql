-- REQ-RDT-SAP-16 (8 Agu, pembalikan alur deadline): TAB harus bisa set deadline DI MUKA per
-- periode saja, sebelum ada dinas manapun upload/menyatakan periode itu -- rdt.period_deadlines
-- (migration 016) butuh pasangan (dinas_inisiasi, dinas_target) yang berarti transaksinya harus
-- sudah ada, itu yang kebalik. Tabel ini terpisah, TIDAK menggantikan period_deadlines -- override
-- per-pasangan tetap dipakai (dan tetap menang di lookup, lihat rules/periodEffective.js's
-- pickDeadline) begitu pasangan itu benar-benar eksis.
CREATE TABLE IF NOT EXISTS rdt.period_default_deadlines (
  periode         text PRIMARY KEY, -- 'YYYY-MM', format sama dengan rdt.uploads.period
  deadline_at     timestamptz NOT NULL,
  set_by_user_id  text NOT NULL, -- tanpa FK, konvensi sama seperti kolom *_user_id lain
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
