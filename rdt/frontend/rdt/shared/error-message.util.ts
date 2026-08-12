// Checklist section 3 (12 Agu) — app-wide error-message display gap: most catch blocks showed
// `err?.message || err`, which for an HttpErrorResponse (what every failed HttpClient call
// actually throws) is Angular's own generic wrapper text ("Http failure response for
// http://localhost:4000/api/... : 500 Internal Server Error") — NEVER the real message the
// backend put in its `{ok:false, error:'...'}` body (that lives at `err.error.error`). A handful
// of call sites already got this right (`err?.error?.error || err?.message || fallback`); most
// didn't. One shared helper instead of fixing the precedence by hand at 30-ish call sites (and
// risking a future one repeating the same mistake).
export function extractErrorMessage(err: unknown, fallback: string): string {
  const httpBody = (err as { error?: { error?: string } } | null)?.error;
  if (httpBody && typeof httpBody === 'object' && typeof httpBody.error === 'string') {
    return httpBody.error;
  }
  const message = (err as { message?: string } | null)?.message;
  if (typeof message === 'string' && message) return message;
  return fallback;
}
