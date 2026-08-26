// Checklist 1.3 (12 Agu) — shared validation for every free-text field a user can submit
// (comments, closing_description, reviewer_note, reply Confirm/Reject, alasan split share-cost,
// dst). Before this, all 8 call sites across routes/*.js and index.js trusted these fields
// ENTIRELY: no length cap anywhere, backend or frontend, and every destination column is an
// unbounded Postgres `text` — nothing between "user typed it" and "it's in the database" ever
// checked size. Centralized here (pure function, unit-testable without Express/DB) rather than
// 8 独立 copies, since the rule itself is identical everywhere — only whether the field is
// required differs per call site.
export const MAX_FREE_TEXT_LENGTH = 2000;

export interface ValidateFreeTextOptions {
  required?: boolean;
  fieldLabel?: string;
  maxLength?: number;
}

export type ValidateFreeTextResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string; code: 'REQUIRED' | 'TEXT_TOO_LONG' };

// validateFreeText(raw, opts) -> { ok: true, value: string|null } | { ok: false, error, code }
//   raw: whatever the client sent (may be undefined/null/non-string — never trusted as-is)
//   opts.required: true rejects an empty/whitespace-only value; false lets it through as null
//   opts.fieldLabel: used in the error message ("Deskripsi wajib diisi", dst)
//   opts.maxLength: override the 2000-char default if a specific field ever needs a different cap
export function validateFreeText(
  raw: unknown,
  options: ValidateFreeTextOptions = {},
): ValidateFreeTextResult {
  const {
    required = false,
    fieldLabel = 'Teks',
    maxLength = MAX_FREE_TEXT_LENGTH,
  } = options;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    if (required)
      return {
        ok: false,
        error: `${fieldLabel} wajib diisi`,
        code: 'REQUIRED',
      };
    return { ok: true, value: null };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      error: `${fieldLabel} terlalu panjang (maksimum ${maxLength} karakter, saat ini ${trimmed.length})`,
      code: 'TEXT_TOO_LONG',
    };
  }
  return { ok: true, value: trimmed };
}
