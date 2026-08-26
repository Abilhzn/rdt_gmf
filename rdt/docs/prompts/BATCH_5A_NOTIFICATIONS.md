# PROMPT — Batch 5a: Notifications

> Tempel ke agent eksekutor. Rujukan: `RENCANA_REWRITE_NESTJS.md` (§8 Batch 5).
> Backend lama `rdt/backend/` **JANGAN disentuh**. **Jangan pecahkan 175 test yang sudah hijau.**
> Sumber: `rdt/backend/src/routes/notifications.js` (port faithful). Modul kecil & aman — 2 endpoint,
> murni baca + mark-read, **tak ada state transaksi tersentuh**.

## Tugas: `modules/repost/notification/` (atau `modules/notification/` — konsisten style modul lain)

Guard: `requireUser`-equivalent saja (identity ada, tak perlu TAB/role tertentu — semua user login).

1. **`GET notifications`** —
   `SELECT n.id, n.comment_id, n.created_at, n.read_at, c.body, c.author_user_id, c.transaction_id,
   t.dinas_inisiasi, t.dinas_target FROM notifications n JOIN comments c ON c.id=n.comment_id
   JOIN transactions t ON t.id=c.transaction_id WHERE n.recipient_user_id=:userId
   ORDER BY n.created_at DESC LIMIT 50`.
   Lampirkan `author_display_name` dari `DirectoryProvider` (3b) — fallback ke `author_user_id` kalau
   user tak ada di directory. Response: `{ unread_count, notifications }` — `unread_count` = hitung
   `read_at IS NULL` dari 50 hasil di atas (bukan query count terpisah, port apa adanya).

2. **`POST notifications/mark-read`** —
   `UPDATE notifications SET read_at=now() WHERE recipient_user_id=:userId AND read_at IS NULL`.
   Tak perlu transaksi (single statement). Response: `{ success: true }` (konvensi ApiResponse baru).

## Acceptance (HTTP nyata lawan `rdt_dev`; data uji dibersihkan balik ke seed setelahnya)
- [ ] User dengan notifikasi ter-mention (dari batch manapun sebelumnya — 3b/3c/4b sudah nulis ke
  tabel `notifications`) → `GET notifications` mengembalikan entri itu dengan `author_display_name`
  terisi benar, `unread_count` sesuai.
- [ ] `POST mark-read` → semua notif user itu `read_at` terisi; `GET notifications` berikutnya →
  `unread_count: 0` (entri tetap muncul di list, cuma `read_at` sekarang terisi).
- [ ] User tanpa notifikasi → `{ unread_count: 0, notifications: [] }`.
- [ ] Tanpa identity → 401.
- [ ] **175 test lama tetap hijau**; build/lint bersih; `rdt/backend/` tak berubah.

## Setelah selesai
Laporkan: struktur module, hasil tiap acceptance, konfirmasi 175 test lama hijau.
Update `RENCANA_REWRITE_NESTJS.md` §0 → Batch 5a ✅.
