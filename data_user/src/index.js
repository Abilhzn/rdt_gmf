/**
 * data_user — employee/user directory service, shared across budgeting_gmf apps (rdt, future
 * ibt). Restructured out of rdt/backend on 24 Jul 2026 so it isn't owned by one app.
 *
 * TODO(IT-AUTH): provisional/synthetic directory ONLY (employee-directory.seed.json). Replace
 * with a lookup against GMF IT's real employee/user table once its name and schema are
 * confirmed (see rdt/docs/SRS.md section 3.7 Open Question) — at that point this file's data
 * source changes, but callers (auth service, rdt/backend) keep using the same HTTP contract.
 */
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

function loadDirectory() {
  const p = path.join(__dirname, '..', 'employee-directory.seed.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete raw._comment;
  return raw;
}

const app = express();
app.use(cors());

app.get('/health', (req, res) => res.json({ ok: true, service: 'data_user' }));

// GET /employees — full directory (mirrors rdt/backend's old GET /api/directory). Used by:
// auth service (credential verification), rdt/backend (comment author names, @mention
// resolution, notification display names).
app.get('/employees', (req, res) => {
  try {
    res.json({ ok: true, employees: loadDirectory() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /employees/:id — single lookup, 404 if unknown. Used by auth service during login.
app.get('/employees/:id', (req, res) => {
  try {
    const directory = loadDirectory();
    const entry = directory[req.params.id];
    if (!entry) return res.status(404).json({ ok: false, error: 'unknown user_id' });
    res.json({ ok: true, id: req.params.id, employee: entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 4002;
if (require.main === module) {
  app.listen(PORT, () => console.log(`data_user service listening on http://localhost:${PORT}`));
}

module.exports = { app };
