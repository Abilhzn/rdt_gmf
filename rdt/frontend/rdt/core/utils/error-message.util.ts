// backend's GlobalExceptionFilter error body: `{ statusCode, message, error, errorCategory? }`
// — different shape from the old backend's `{ ok:false, error }` (see `shared/error-message.util.ts`,
// still used by the not-yet-migrated feature modules). For an HttpErrorResponse (what every failed
// HttpClient call throws), `err?.message` is Angular's own generic wrapper text, never the real
// backend message — that lives at `err.error.message`.
export function extractErrorMessage(err: unknown, fallback: string): string {
  const httpBody = (err as { error?: { message?: string } } | null)?.error;
  if (httpBody && typeof httpBody === 'object' && typeof httpBody.message === 'string') {
    return httpBody.message;
  }
  const message = (err as { message?: string } | null)?.message;
  if (typeof message === 'string' && message) return message;
  return fallback;
}
