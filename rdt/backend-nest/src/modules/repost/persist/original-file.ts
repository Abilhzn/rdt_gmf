// Strips to a bare filename and drops anything outside a conservative safe set, so a hostile
// original_filename can't traverse out of the upload storage. Splits on "/" and "\" manually
// rather than via path.basename(): this is untrusted client input, and path.basename ignores
// "\" on POSIX -- relying on it would make traversal-stripping silently OS-dependent.
//
// Port 1:1 dari sisi sanitasi backend/src/persist/originalFile.js. Operasi tulis file yang asli
// (fs.renameSync ke uploadDir) SENGAJA tidak di-port di sini -- itu pindah ke StorageService di
// Batch 3.5b, bukan `fs` langsung. Pemanggil nanti tinggal: nama final = `${uploadId}-${sanitizeFilename(originalFilename)}`,
// lalu serahkan ke StorageService untuk ditulis.

export function sanitizeFilename(name: unknown): string {
  // port apa adanya; name selalu string atau nullish di praktiknya (original_filename dari multer).
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const raw = String(name || 'upload.xlsx');
  const lastSegment = raw.split(/[\\/]/).pop() || 'upload.xlsx';
  const cleaned = lastSegment.replace(/[^A-Za-z0-9._-]+/g, '_');
  return cleaned.slice(-150) || 'upload.xlsx';
}
