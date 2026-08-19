const fs = require('fs');
const path = require('path');

// Strips to a bare filename and drops anything outside a conservative safe set, so a hostile
// original_filename can't traverse out of uploadDir. Splits on "/" and "\" manually rather than
// via path.basename(): this is untrusted client input, and path.basename ignores "\" on POSIX —
// relying on it would make traversal-stripping silently OS-dependent.
function sanitizeFilename(name) {
  const raw = String(name || 'upload.xlsx');
  const lastSegment = raw.split(/[\\/]/).pop() || 'upload.xlsx';
  const cleaned = lastSegment.replace(/[^A-Za-z0-9._-]+/g, '_');
  return cleaned.slice(-150) || 'upload.xlsx';
}

// Persists the original uploaded workbook byte-for-byte so it can be downloaded later. Prefixing
// with the upload's own DB id avoids collisions without a separate timestamp/uuid scheme. Returns
// a path RELATIVE to uploadDir, not absolute, for portability across environments.
function saveOriginalFile(uploadDir, uploadId, tempFilePath, originalFilename) {
  const finalName = `${uploadId}-${sanitizeFilename(originalFilename)}`;
  fs.renameSync(tempFilePath, path.join(uploadDir, finalName));
  return finalName;
}

module.exports = { sanitizeFilename, saveOriginalFile };
