/**
 * Base class untuk semua domain error. Module lain extend ini (mis. `NotFoundDomainError`,
 * `InvalidStateDomainError`) daripada balikin `{ ok: false, error }` (anti-pattern, lihat
 * RENCANA_REWRITE_NESTJS.md §6). Ditangkap oleh `GlobalExceptionFilter`.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly errorCode: string = 'DOMAIN_ERROR',
    // Optional konteks tambahan (mis. `error_category` dari classifyError, Batch 3) yang harus
    // ikut disertakan di response — lihat GlobalExceptionFilter.
    public readonly errorCategory?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
