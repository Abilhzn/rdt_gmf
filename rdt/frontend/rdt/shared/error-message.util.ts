// For an HttpErrorResponse (what every failed HttpClient call throws), `err?.message` is
// Angular's own generic wrapper text, NEVER the real message the backend put in its
// `{ok:false, error:'...'}` body (that lives at `err.error.error`). One shared helper for the
// right precedence instead of every call site getting it wrong.
export function extractErrorMessage(err: unknown, fallback: string): string {
  const httpBody = (err as { error?: { error?: string } } | null)?.error;
  if (httpBody && typeof httpBody === 'object' && typeof httpBody.error === 'string') {
    return httpBody.error;
  }
  const message = (err as { message?: string } | null)?.message;
  if (typeof message === 'string' && message) return message;
  return fallback;
}
