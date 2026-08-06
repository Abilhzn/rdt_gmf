-- REQ-RDT-SAP-14 (REVISI TOTAL 5 Agu): deadline konfirmasi PER PASANGAN (dinas_inisiasi x
-- dinas_target x periode), bukan satu deadline global. Mengikat kapan DINAS TARGET
-- melakukan aksi Confirm/Reject, bukan kapan TAB repost -- lihat rules/periodEffective.js
-- untuk logic yang membaca tabel ini.
CREATE TABLE IF NOT EXISTS rdt.period_deadlines (
  id              bigserial PRIMARY KEY,
  dinas_inisiasi  text NOT NULL REFERENCES rdt.dinas(code),
  dinas_target    text NOT NULL REFERENCES rdt.dinas(code),
  periode         text NOT NULL, -- 'YYYY-MM', format sama dengan rdt.uploads.period
  deadline_at     timestamptz NOT NULL,
  set_by_user_id  text NOT NULL, -- tanpa FK, konvensi sama seperti kolom *_user_id lain
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dinas_inisiasi, dinas_target, periode)
);
