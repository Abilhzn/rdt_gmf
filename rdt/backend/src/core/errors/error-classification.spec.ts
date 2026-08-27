import { classifyError, CATEGORY } from './error-classification';

describe('classifyError (REQ-RDT-LEDGER-05 / REQ-RDT-AUDIT-02)', () => {
  test('Postgres lock/deadlock codes -> KONFLIK_KONKURENSI', () => {
    expect(classifyError({ code: '55P03' })).toBe(
      CATEGORY.CONCURRENCY_CONFLICT,
    );
    expect(classifyError({ code: '40P01' })).toBe(
      CATEGORY.CONCURRENCY_CONFLICT,
    );
    expect(classifyError({ code: '40001' })).toBe(
      CATEGORY.CONCURRENCY_CONFLICT,
    );
  });

  test('Postgres class-23 constraint violation -> DATA_TIDAK_VALID', () => {
    expect(classifyError({ code: '23505' })).toBe(CATEGORY.INVALID_DATA); // unique_violation
    expect(classifyError({ code: '23503' })).toBe(CATEGORY.INVALID_DATA); // foreign_key_violation
  });

  test('network-level codes -> KONEKSI_TERPUTUS', () => {
    expect(classifyError({ code: 'ECONNREFUSED' })).toBe(
      CATEGORY.CONNECTION_LOST,
    );
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe(CATEGORY.CONNECTION_LOST);
  });

  test('message-based fallback for connection loss when no pg code present', () => {
    expect(classifyError(new Error('Connection terminated unexpectedly'))).toBe(
      CATEGORY.CONNECTION_LOST,
    );
  });

  test('app-thrown validation errors (no pg code) -> DATA_TIDAK_VALID', () => {
    expect(classifyError(new Error('transaction not pending: 42'))).toBe(
      CATEGORY.INVALID_DATA,
    );
    expect(classifyError(new Error('transaction target mismatch: 42'))).toBe(
      CATEGORY.INVALID_DATA,
    );
  });

  test('unrecognized error -> LAINNYA', () => {
    expect(classifyError(new Error('something weird happened'))).toBe(
      CATEGORY.OTHER,
    );
  });

  test('null/undefined -> LAINNYA, never throws', () => {
    expect(classifyError(null)).toBe(CATEGORY.OTHER);
    expect(classifyError(undefined)).toBe(CATEGORY.OTHER);
  });
});
