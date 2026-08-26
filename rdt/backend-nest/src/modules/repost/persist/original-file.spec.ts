import { sanitizeFilename } from './original-file';

test('keeps a normal filename as-is', () => {
  expect(sanitizeFilename('06. DT TB - Jun 2026.xlsx')).toBe(
    '06._DT_TB_-_Jun_2026.xlsx',
  );
});

test('strips directory components — no path traversal via a crafted original_filename', () => {
  expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
  expect(sanitizeFilename('..\\..\\windows\\system32\\evil.xlsx')).toBe(
    'evil.xlsx',
  );
});

test('falls back to a default name when given nothing usable', () => {
  expect(sanitizeFilename(null)).toBe('upload.xlsx');
  expect(sanitizeFilename('')).toBe('upload.xlsx');
});
