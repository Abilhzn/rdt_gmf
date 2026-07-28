const fs = require('fs');
const path = require('path');

// Strip to a bare filename (no directory components survive) and drop anything outside a
// conservative safe set, so a hostile original_filename can't traverse out of uploadDir or
// collide with control characters — REQ-RDT-EXT-08. Splits on "/" and "\" manually rather than
// via path.basename(): this value is untrusted client input (a suggested display name from the
// browser), not a path being resolved on the server's own OS, and path.basename ignores "\" on
// POSIX — relying on it would make the traversal-stripping behavior silently OS-dependent.
function sanitizeFilename(name) {
  const raw = String(name || 'upload.xlsx');
  const lastSegment = raw.split(/[\\/]/).pop() || 'upload.xlsx';
  const cleaned = lastSegment.replace(/[^A-Za-z0-9._-]+/g, '_');
  return cleaned.slice(-150) || 'upload.xlsx';
}

// REQ-RDT-EXT-08: persist the original uploaded workbook byte-for-byte (not a re-export) so
// REQ-RDT-LEDGER-09's "download with live formulas" can serve it later. Prefixing with the
// upload's own DB id (already unique per row) avoids collisions without a separate
// timestamp/uuid scheme. Returns a path stored RELATIVE to uploadDir, not absolute — see
// routes/uploads.js for why (portability across environments).
function saveOriginalFile(uploadDir, uploadId, tempFilePath, originalFilename) {
  const finalName = `${uploadId}-${sanitizeFilename(originalFilename)}`;
  fs.renameSync(tempFilePath, path.join(uploadDir, finalName));
  return finalName;
}

module.exports = { sanitizeFilename, saveOriginalFile };
