// Dipakai `POST /` dan `POST /default` -- keduanya terima { periode, deadline_at }, cuma beda
// ada/tidaknya pasangan spesifik yang ikut. Port apa adanya dari
// `routes/periodDeadlines.js`'s validatePeriodAndDeadline.

export const PERIODE_RE = /^\d{4}-\d{2}$/;

export type ValidatePeriodAndDeadlineResult =
  { ok: true; deadlineAt: Date } | { ok: false; error: string };

export function validatePeriodAndDeadline(args: {
  periode: unknown;
  deadline_at: unknown;
}): ValidatePeriodAndDeadlineResult {
  const { periode, deadline_at: deadlineAtRaw } = args;
  if (typeof periode !== 'string' || !PERIODE_RE.test(periode)) {
    return { ok: false, error: "periode must be 'YYYY-MM'" };
  }
  const deadlineAt = deadlineAtRaw ? new Date(deadlineAtRaw as string) : null;
  if (!deadlineAt || isNaN(deadlineAt.getTime())) {
    return { ok: false, error: 'deadline_at must be a valid date/time' };
  }
  return { ok: true, deadlineAt };
}
