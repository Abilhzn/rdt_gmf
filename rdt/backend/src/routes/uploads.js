const express = require('express');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

// Same directory index.js's multer instance writes into (rdt/backend/uploads/).
const uploadDir = path.join(__dirname, '..', '..', 'uploads');

// Mounted at /api/uploads in index.js.
// GET /api/uploads/:uploadId/download — serves the ORIGINAL uploaded workbook byte-for-byte
// (formulas intact), not a re-export. Gated the same way as the Confirmation page itself: only
// the upload's own initiator dinas, a dinas that upload actually has a transaction targeting, or TAB.
router.get('/:uploadId/download', requireUser, async (req, res) => {
  const uploadId = Number(req.params.uploadId);
  if (!Number.isInteger(uploadId)) return res.status(400).json({ ok: false, error: 'invalid uploadId' });
  if (!process.env.DATABASE_URL) return res.status(400).json({ ok: false, error: 'DB not configured' });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const upRes = await client.query(
      'SELECT id, dinas_code, original_filename, original_file_path FROM rdt.uploads WHERE id=$1',
      [uploadId]
    );
    if (!upRes.rows.length) return res.status(404).json({ ok: false, error: 'upload not found' });
    const upload = upRes.rows[0];
    if (!upload.original_file_path) return res.status(404).json({ ok: false, error: 'original file not available for this upload' });

    const user = req.rdtUser;
    if (user.role !== 'TAB') {
      const isInitiator = String(upload.dinas_code).toUpperCase() === String(user.dinas).toUpperCase();
      let isTarget = false;
      if (!isInitiator) {
        // Checking only the current dinas_target would mean a dinas that DECLINED and got
        // reassigned away loses download access entirely, even though dashboard.js's own
        // pair-detail/comment endpoints still treat them as entitled to view that history. A dinas
        // counts as "isTarget" if it's the CURRENT dinas_target of any transaction in this upload,
        // OR if it shows up as a past dinas_target in that transaction's REASSIGN/REJECT_REDIRECT
        // audit trail — no cap on how many hops back.
        const targetUpper = String(user.dinas).toUpperCase();
        const directRes = await client.query(
          'SELECT 1 FROM rdt.transactions WHERE upload_id=$1 AND UPPER(dinas_target)=UPPER($2) LIMIT 1',
          [uploadId, user.dinas]
        );
        isTarget = directRes.rows.length > 0;
        if (!isTarget) {
          const chainRes = await client.query(
            `SELECT 1 FROM rdt.audit_log a
             JOIN rdt.transactions t ON t.id = a.transaction_id
             WHERE t.upload_id = $1 AND a.action IN ('REASSIGN', 'REJECT_REDIRECT')
               AND UPPER(a.detail->>'from_dinas') = $2
             LIMIT 1`,
            [uploadId, targetUpper]
          );
          isTarget = chainRes.rows.length > 0;
        }
      }
      if (!isInitiator && !isTarget) {
        return res.status(403).json({ ok: false, error: `user ${user.id} (dinas=${user.dinas}) not authorized to download upload ${uploadId}` });
      }
    }

    // original_file_path is stored relative to uploadDir with no directory components
    // (persist/originalFile.js sanitizes to a bare filename) — re-basename it here too as
    // defense in depth against path traversal.
    const safeName = path.basename(String(upload.original_file_path));
    const absPath = path.join(uploadDir, safeName);
    if (!fs.existsSync(absPath)) return res.status(404).json({ ok: false, error: 'original file missing on disk' });
    res.download(absPath, upload.original_filename || safeName);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

module.exports = router;
