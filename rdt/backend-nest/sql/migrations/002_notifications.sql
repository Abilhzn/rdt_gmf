-- REQ-RDT-COMMENT-03: @mention notifications for the Dashboard-Detailing comment thread.
-- Purely additive (new table only) — no existing table is altered. Notifications are notify-
-- only (badge/list), never trigger any transaction status change or reassignment (see
-- SRS.md 3.8 REQ-RDT-NAV-03 clarification).
CREATE TABLE IF NOT EXISTS rdt.notifications (
  id                bigserial PRIMARY KEY,
  recipient_user_id text NOT NULL,
  comment_id        bigint NOT NULL REFERENCES rdt.comments(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON rdt.notifications (recipient_user_id, read_at);
