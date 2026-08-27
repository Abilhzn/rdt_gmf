import { validateFreeText, MAX_FREE_TEXT_LENGTH } from './text-validation';

describe('validateFreeText', () => {
  test('trims and accepts a normal string', () => {
    expect(validateFreeText('  hello  ')).toEqual({ ok: true, value: 'hello' });
  });

  test('optional + empty/whitespace-only -> ok with null, no error', () => {
    expect(validateFreeText('', { required: false })).toEqual({
      ok: true,
      value: null,
    });
    expect(validateFreeText('   ', { required: false })).toEqual({
      ok: true,
      value: null,
    });
    expect(validateFreeText(undefined, { required: false })).toEqual({
      ok: true,
      value: null,
    });
    expect(validateFreeText(null, { required: false })).toEqual({
      ok: true,
      value: null,
    });
  });

  test('required + empty/whitespace-only -> rejected with code REQUIRED', () => {
    const res = validateFreeText('   ', {
      required: true,
      fieldLabel: 'Catatan',
    });
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('REQUIRED');
    expect((res as { error: string }).error).toContain('Catatan');
  });

  test('within the 2000-char default limit is accepted', () => {
    const text = 'a'.repeat(MAX_FREE_TEXT_LENGTH);
    expect(validateFreeText(text)).toEqual({ ok: true, value: text });
  });

  test('over the default limit is rejected with code TEXT_TOO_LONG, does not silently truncate', () => {
    const text = 'a'.repeat(MAX_FREE_TEXT_LENGTH + 1);
    const res = validateFreeText(text, { fieldLabel: 'Catatan Reviewer' });
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('TEXT_TOO_LONG');
    expect((res as { error: string }).error).toContain('Catatan Reviewer');
    expect((res as { error: string }).error).toContain(
      String(MAX_FREE_TEXT_LENGTH),
    );
  });

  test('non-string input (e.g. a number/object accidentally sent) is treated as empty, not thrown', () => {
    expect(validateFreeText(12345, { required: false })).toEqual({
      ok: true,
      value: null,
    });
    expect(() => validateFreeText({ nested: 'x' })).not.toThrow();
  });

  test('a custom maxLength overrides the default', () => {
    const res = validateFreeText('a'.repeat(11), {
      maxLength: 10,
      fieldLabel: 'Kode',
    });
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('TEXT_TOO_LONG');
  });
});
