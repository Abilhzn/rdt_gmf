/**
 * Backend server exposing the RDT API, consumed by the Angular dev-shell frontend
 * (rdt/frontend/dev-shell, `ng serve`, port 4200) — the standalone ui-demo.html frontend this
 * used to also serve was removed 7 Agu 2026.
 * - POST /api/parse  : accepts multipart/form-data with field `file` and returns parsed rows + aggregation
 *
 * This server should eventually be integrated into the team's existing Node.js backend with
 * proper auth, logging, and error handling.
 */

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');

const { parseExcelFile, CONTRACT_FIELDS } = require('./parser/excelParser');
const { flagDuplicates } = require('./persist/duplicateCheck');
const { evaluateSupersede } = require('./persist/supersedeCheck');
const { saveOriginalFile } = require('./persist/originalFile');
const { currentAutoPeriode } = require('./rules/periodEffective');
const confirmationRouter = require('./routes/confirmation');
const reassignmentRouter = require('./routes/reassignment');
const exportBatchesRouter = require('./routes/exportBatches');
const dashboardRouter = require('./routes/dashboard');
const uploadsRouter = require('./routes/uploads');
const notificationsRouter = require('./routes/notifications');
const investigationRouter = require('./routes/investigation');
const shareCostRouter = require('./routes/shareCost');
const periodDeadlinesRouter = require('./routes/periodDeadlines');
const { requireUser, requireRole } = require('./middleware/auth');
const { loadDirectory } = require('./dataUserClient');
const { resolveMentionedUserIds, filterMentionsToPair } = require('./rules/mentionRules');
const { validateFreeText } = require('./rules/textValidation');
const { Client } = require('pg');
const { errorLoggingMiddleware, logRollbackAudit } = require('./logger');

const app = express();
// Checklist 1.2 (11 Agu): baseline security headers — same 'none' CSP rationale as
// auth/data_user (see auth/src/index.js's comment): this service is JSON API + file
// download/upload only, never renders its own HTML/script/style, so lock CSP down as
// defense-in-depth. Content-Disposition:attachment downloads (original file, SAP export) are
// unaffected — CSP governs how a page loads resources, not how a browser handles a download.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'none'"],
      imgSrc: ["'none'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  frameguard: { action: 'deny' }, // X-Frame-Options: DENY — matches frameAncestors 'none' above
  hsts: { maxAge: 15552000, includeSubDomains: true },
}));
// Checklist 2.2 (12 Agu): every 5xx response logged to logs/error.log — see logger.js.
app.use(errorLoggingMiddleware('rdt-backend'));
// Checklist 2.2 (12 Agu): a request whose handler hangs (stuck DB query, unreachable upstream
// service, etc.) used to just leave the client's spinner running forever with no server-side
// signal at all. 30s is generous (the widest legitimate operation here, a >300-row SAP export,
// still completes well under that) but bounds every request to SOME response. Paired with the
// Angular TimeoutInterceptor (frontend, same 30s) so the client-side wait is bounded even if this
// server-side timer somehow doesn't fire (e.g. process itself wedged).
app.use((req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({ ok: false, error: 'Request timeout — server tidak merespons dalam 30 detik. Coba lagi.', code: 'REQUEST_TIMEOUT' });
      // The original handler may still be mid-flight (Node/pg can't force-cancel an in-progress
      // query) and could try to write its own response after we've already sent this one —
      // silently swallow that instead of letting it throw ERR_HTTP_HEADERS_SENT and crash the
      // process. json/end already no-op past headersSent for THIS response going forward.
      res.json = () => res;
      res.end = () => res;
    }
  }, 30000);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});
// Default express.json() body limit is 100kb — a real monthly Excel file easily produces
// thousands of rows x 53+ columns (+ raw_payload) as JSON, well past that. Without this,
// POST /api/persist silently 413s and Express's default HTML error page gets returned
// instead of JSON, which then fails client-side with "Unexpected token '<' ... not valid JSON".
app.use(express.json({ limit: '50mb' }));
const cors = require('cors');
app.use(cors());

// prepare directories
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Helper to load/write config JSON files used by parser
const configDir = path.join(__dirname, 'config');
function readConfig(name) {
  const p = path.join(configDir, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeConfig(name, obj) {
  const p = path.join(configDir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

// REQ-RDT-EXT-04 fix (13 Agu, audit finding): mapping/exclusions/dinasCodes used to always come
// from the JSON seed files even when DATABASE_URL is set — PUT /api/mapping and PUT /api/exclusions
// below write to rdt.dinas_mapping/rdt.exclusion_rules in that case, so the parser never reflected
// what TAB actually edited. Mirrors the exact SELECTs those GET routes already use, just bundled
// for excelParser.js's parseExcelFile options. Returns null (caller falls back to JSON) when no DB.
async function loadDbRoutingConfig() {
  if (!process.env.DATABASE_URL) return null;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const [mappingRes, exclusionsRes, dinasRes] = await Promise.all([
      client.query('SELECT prefix, dinas_code FROM rdt.dinas_mapping'),
      client.query('SELECT prefix FROM rdt.exclusion_rules'),
      client.query('SELECT code FROM rdt.dinas'),
    ]);
    const mapping = {};
    mappingRes.rows.forEach((row) => { mapping[row.prefix] = row.dinas_code; });
    return {
      mapping,
      exclusions: { prefixes: exclusionsRes.rows.map((r) => r.prefix) },
      dinasCodes: dinasRes.rows.map((r) => r.code),
    };
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

// Ensure staging area exists for commits
const stagingDir = path.join(__dirname, '..', 'staging');
if (!fs.existsSync(stagingDir)) fs.mkdirSync(stagingDir, { recursive: true });

// store uploads to disk temporarily
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
// fieldSize default (1MB) is too small for /api/persist's `rows` field — it's the FULL parsed
// row set (incl. raw_payload per row) re-sent as JSON text, which for a large dinas file (e.g.
// TB's ~3.9MB source, hundreds of rows) comfortably exceeds 1MB. Busboy aborts the connection
// non-gracefully on overflow (no clean HTTP response), which is why this showed up as a hung
// "Memproses..." / opaque 500 rather than a readable error — see the global error handler below
// for the other half of this fix.
const upload = multer({ storage, limits: { fieldSize: 25 * 1024 * 1024 } });

// Basic aggregation helper used by the demo API response
function aggregateResults(results) {
  const out = {};
  results.forEach((r) => {
    if (r.status_konfirmasi !== 'PENDING') return;
    const cat = r.category || 'Unknown';
    const dt = r.dinas_target || 'Unknown';
    out[cat] = out[cat] || {};
    out[cat][dt] = (out[cat][dt] || 0) + Number(r.nominal || 0);
  });
  Object.keys(out).forEach((cat) => {
    Object.keys(out[cat]).forEach((dt) => {
      out[cat][dt] = Math.round(out[cat][dt] * 100) / 100;
    });
  });
  return out;
}

// API: parse uploaded Excel and return parsed rows + aggregated summary
app.post('/api/parse', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required (field name: file)' });
  const fp = req.file.path;
  // Uploader dinas is derived server-side from the authenticated user, never trusted from the
  // client body — same rule as confirmation.js/reassignment.js.
  const uploaderDinas = req.rdtUser.dinas;
  try {
    // REQ-RDT-EXT-04 fix — pass DB-sourced mapping/exclusions/dinasCodes when a DB is configured,
    // so TAB's Admin UI edits (PUT /api/mapping, PUT /api/exclusions) actually take effect. `null`
    // when DATABASE_URL isn't set — parseExcelFile falls back to the JSON seed files as before.
    const dbConfig = await loadDbRoutingConfig();
    const rows = await parseExcelFile(fp, { uploaderDinas, ...(dbConfig || {}) });
    // Bug found 25 Jul (project owner report against contoh_input/06. DT TJ - Jun 2026.xlsx):
    // a workbook whose ONLY sheet is a pivot/summary export (no 53-column detail sheet at all)
    // used to silently return `rows: []` with ok:true — the Repost page just showed all-zero
    // counts and an empty table with no explanation, easy to mistake for "it worked, there's
    // nothing to repost" instead of "this file has no transaction-level detail to extract at
    // all". Zero results here specifically means every sheet in the workbook was skipped (pivot/
    // lookup-shaped, or missing the required headers) — a real file with actual data rows would
    // always produce at least SOME row (even just NEEDS_REVIEW/INVALID ones), so this is a safe
    // signal to surface as an explicit error rather than a silent empty success.
    if (rows.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'File tidak mengandung baris detail transaksi yang bisa diproses — semua sheet di file ini terdeteksi sebagai pivot/summary atau tidak sesuai format kontrak 53 kolom. Pastikan file yang diupload adalah file detail transaksi (DT), bukan file ringkasan/pivot saja.',
      });
    }
    const agg = aggregateResults(rows);
    res.json({ ok: true, rows, aggregation: agg });
  } catch (err) {
    console.error('parse error', err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    // cleanup uploaded file
    try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
  }
});

// ui-demo.html (the standalone vanilla-JS demo UI this used to serve at '/' and '/rdt/demo')
// was removed 7 Agu 2026 — the Angular dev-shell (rdt/frontend/dev-shell, `ng serve`, port 4200)
// is now the only frontend, per project owner instruction. This server is API-only from here on.
app.get('/', (req, res) => res.json({ ok: true, service: 'rdt-backend', frontend: 'http://localhost:4200/rdt' }));

// Checklist 2.2 (12 Agu): the other 2 backend services already had this at the conventional
// `/health` path (auth/data_user, both trivial "process is alive" checks) — this one was missing
// AND, being the service every write actually goes through, is worth making more useful than a
// bare "process alive" ping: it actually round-trips the database, so "service up but DB
// unreachable" (a real, distinct failure mode — Supabase pooler hiccup, wrong DATABASE_URL after
// a redeploy, etc.) shows up as db:"error" here instead of masquerading as a healthy service that
// then 500s on every real request. No auth required, same convention as auth/data_user's /health
// and this file's own GET / — a liveness probe has to be reachable without a login.
app.get('/health', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.json({ ok: true, service: 'rdt-backend', db: 'not_configured' });
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('SELECT 1');
    res.json({ ok: true, service: 'rdt-backend', db: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, service: 'rdt-backend', db: 'error', error: String(err.message || err) });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

// GET /api/directory — employee directory, used for the @mention autocomplete + comment/
// notification author display names. Restructured 24 Jul 2026: proxies to the data_user
// service instead of reading a local file (see rdt/backend/src/middleware/auth.js's header
// comment for why identity/directory data moved out of this app).
app.get('/api/directory', requireUser, async (req, res) => {
  try {
    res.json({ ok: true, directory: await loadDirectory() });
  } catch (err) {
    res.status(502).json({ ok: false, error: `Gagal menghubungi data_user service: ${err.message}` });
  }
});

// GET /api/contract-fields — REQ-RDT-NAV-04 (1 Agu, presentation feedback): the Repost Review
// preview table must show the SAME columns that actually get repost-ed, from ONE shared source —
// this is that source. CONTRACT_FIELDS (excelParser.js) is already what routes/exportBatches.js's
// GET /export/:batchId uses to build the real 53-column SAP file; exposing it here means the
// Angular preview table renders columns by iterating this list instead of a second, hand-picked
// column set that could drift out of sync if the contract ever changes.
app.get('/api/contract-fields', requireUser, (req, res) => {
  res.json({ ok: true, fields: CONTRACT_FIELDS.map((f) => ({ key: f.key, label: f.variants[0] })) });
});

// GET /api/dinas — list of active dinas codes (for reassignment target pickers etc.)
app.get('/api/dinas', requireUser, (req, res) => {
  if (process.env.DATABASE_URL) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect().then(async () => {
      try {
        const r = await client.query('SELECT code, name FROM rdt.dinas WHERE is_active = true ORDER BY code');
        res.json({ ok: true, dinas: r.rows });
      } catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
      } finally { try { await client.end(); } catch (e) {} }
    }).catch(err => res.status(500).json({ ok: false, error: String(err) }));
    return;
  }
  try {
    const seed = readConfig('dinas.seed.json') || { codes: [] };
    res.json({ ok: true, dinas: seed.codes.map((c) => ({ code: c, name: c })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET/PUT mapping — checklist 1.1 (12 Agu, audit ketemu ini bisa diakses tanpa login sama
// sekali, termasuk PUT-nya yang nge-rewrite tabel routing dinas): TAB-only, sama gate yang
// dipakai tempat lain buat aksi admin/config (Angular's admin/ module gak punya route guard
// sendiri, jadi backend HARUS jadi lapisan penegakan yang sesungguhnya — jangan percaya
// frontend doang, checklist 1.3's rule yang sama berlaku di sini).
app.get('/api/mapping', requireUser, requireRole('TAB'), (req, res) => {
  // If DB available, read from rdt.dinas_mapping; else fallback to JSON file
  if (process.env.DATABASE_URL) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect().then(async () => {
      try {
        const r = await client.query('SELECT prefix, dinas_code FROM rdt.dinas_mapping');
        const mapping = {};
        r.rows.forEach(row => { mapping[row.prefix] = row.dinas_code; });
        res.json({ ok: true, mapping });
      } catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
      } finally { try { await client.end(); } catch (e){} }
    }).catch(err => res.status(500).json({ ok:false, error: String(err) }));
    return;
  }
  try {
    const mapping = readConfig('mapping.seed.json') || {};
    res.json({ ok: true, mapping });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.put('/api/mapping', requireUser, requireRole('TAB'), express.json(), (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'invalid body' });
  if (process.env.DATABASE_URL) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect().then(async () => {
      try {
        await client.query('BEGIN');
        const keys = Object.keys(body);
        for (const k of keys) {
          const v = body[k];
          await client.query('INSERT INTO rdt.dinas_mapping(prefix,dinas_code) VALUES($1,$2) ON CONFLICT (prefix) DO UPDATE SET dinas_code = EXCLUDED.dinas_code', [k, v]);
        }
        await client.query('COMMIT');
        res.json({ ok: true });
      } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ ok:false, error:String(err) }); }
      finally { try{ await client.end(); }catch(e){} }
    }).catch(err => res.status(500).json({ ok:false, error: String(err) }));
    return;
  }
  try { writeConfig('mapping.seed.json', body); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

// GET/PUT exclusions — checklist 1.1 (12 Agu), same gap/fix as /api/mapping above.
app.get('/api/exclusions', requireUser, requireRole('TAB'), (req, res) => {
  if (process.env.DATABASE_URL) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect().then(async () => {
      try {
        const r = await client.query('SELECT prefix, reason FROM rdt.exclusion_rules');
        const prefixes = r.rows.map(row => ({ prefix: row.prefix, reason: row.reason }));
        res.json({ ok: true, exclusions: { prefixes } });
      } catch (err) { res.status(500).json({ ok:false, error:String(err) }); }
      finally { try{ await client.end(); }catch(e){} }
    }).catch(err => res.status(500).json({ ok:false, error:String(err) }));
    return;
  }
  try { const excl = readConfig('exclusions.config.json') || { prefixes: [] }; res.json({ ok: true, exclusions: excl }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

app.put('/api/exclusions', requireUser, requireRole('TAB'), express.json(), (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || !Array.isArray(body.prefixes)) return res.status(400).json({ ok: false, error: 'invalid body, expected { prefixes: [] }' });
  if (process.env.DATABASE_URL) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect().then(async () => {
      try {
        await client.query('BEGIN');
        // replace all rules: simple approach — delete existing and insert new
        await client.query('DELETE FROM rdt.exclusion_rules');
        for (const p of body.prefixes) {
          if (typeof p === 'string') await client.query('INSERT INTO rdt.exclusion_rules(prefix) VALUES($1) ON CONFLICT DO NOTHING', [p]);
        }
        await client.query('COMMIT');
        res.json({ ok: true });
      } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ ok:false, error:String(err) }); }
      finally { try{ await client.end(); }catch(e){} }
    }).catch(err => res.status(500).json({ ok:false, error: String(err) }));
    return;
  }
  try { writeConfig('exclusions.config.json', body); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

// Commit parsed rows to a staging JSON file (no DB). Expects JSON body { rows: [...], aggregation: {...} }
// Checklist 1.1 (12 Agu): legacy no-DB fallback path, dead code from the frontend's own
// perspective (no caller left — grep confirmed) but still reachable directly — gated same as
// everything else rather than left as the one unauthenticated write endpoint standing.
app.post('/api/commit', requireUser, express.json(), (req, res) => {
  try {
    const body = req.body;
    if (!body || !Array.isArray(body.rows)) return res.status(400).json({ ok: false, error: 'invalid body, expected { rows: [] }' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `committed-${timestamp}.json`;
    const out = {
      meta: { committed_at: new Date().toISOString() },
      aggregation: body.aggregation || {},
      rows: body.rows,
    };
    const fp = path.join(stagingDir, filename);
    fs.writeFileSync(fp, JSON.stringify(out, null, 2), 'utf8');
    res.json({ ok: true, file: fp });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Persist parsed rows into PostgreSQL staging tables (rdt.transactions).
// Uses DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT env vars.
//
// REQ-RDT-EXT-08: the client may now also attach the original workbook (field "file") so its
// bytes can be saved alongside the parsed rows — multer no-ops on a plain JSON request (no
// req.file, req.body already parsed by the global express.json()), so existing JSON-only
// callers are unaffected. On multipart requests, non-file fields arrive as strings, hence the
// JSON.parse below.
app.post('/api/persist', requireUser, upload.single('file'), async (req, res) => {
  const body = req.body || {};
  const rows = typeof body.rows === 'string' ? JSON.parse(body.rows) : body.rows;
  if (!Array.isArray(rows)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    return res.status(400).json({ ok: false, error: 'invalid body, expected { rows: [] }' });
  }
  body.rows = rows;
  body.aggregation = typeof body.aggregation === 'string' ? JSON.parse(body.aggregation) : body.aggregation;

  // REQ-RDT-SAP-13 DIBATALKAN 14 Agu (SRS 3.13): periode tidak lagi diminta dari client sama
  // sekali (dan kalaupun dikirim, diabaikan) — selalu implisit = bulan sebelum bulan upload
  // berjalan (server time), lihat rules/periodEffective.js's currentAutoPeriode.
  const period = currentAutoPeriode();

  // Bug fix (11 Agu, found via live-DB testing): rdt.uploads.original_filename is NOT NULL in
  // the schema, but this route treated it as optional (defaulted to null below) — a caller that
  // omits it hit a raw Postgres constraint-violation 500 instead of a clean validation error.
  // The real Angular Repost flow always sends it (transaction.service.ts falls back to
  // 'unknown.xlsx' when there's no File object), so this should never fire in normal use — this
  // just turns a latent gap into a proper 400 for any other caller.
  const originalFilenameTrimmed = typeof body.original_filename === 'string' ? body.original_filename.trim() : '';
  if (!originalFilenameTrimmed) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    return res.status(400).json({ ok: false, error: 'original_filename is required' });
  }

  // Checklist 1.3 (12 Agu): description (Keterangan Repost, level upload) and each row's
  // reviewer_note (Catatan Reviewer, per-baris) were never length-checked — trusted entirely as
  // free text straight into an unbounded `text` column. All-or-nothing: one row's reviewer_note
  // too long rejects the whole persist call, same convention `period`/`original_filename` above
  // already use for this endpoint (no partial-write half-state).
  const descriptionCheck = validateFreeText(body.description, { fieldLabel: 'Deskripsi' });
  if (!descriptionCheck.ok) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    return res.status(400).json(descriptionCheck);
  }
  body.description = descriptionCheck.value;
  for (let i = 0; i < body.rows.length; i++) {
    const reviewerNoteCheck = validateFreeText(body.rows[i].reviewer_note, { fieldLabel: `Catatan Reviewer (baris ${i + 1})` });
    if (!reviewerNoteCheck.ok) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
      return res.status(400).json(reviewerNoteCheck);
    }
    body.rows[i].reviewer_note = reviewerNoteCheck.value;
  }

  // If no DB config, fallback to staging JSON
  const hasDb = !!(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGUSER || process.env.PGDATABASE);
  if (!hasDb) {
    // fallback behavior: write to staging same as /api/commit. There's no rdt.uploads row in
    // this path to attach an original_file_path to, so the uploaded original (if any) can't be
    // kept — clean up the temp file rather than leaking it in uploadDir forever.
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `persisted-${timestamp}.json`;
      const out = {
        meta: { persisted_at: new Date().toISOString(), fallback: true },
        aggregation: body.aggregation || {},
        rows: body.rows,
      };
      const fp = path.join(stagingDir, filename);
      fs.writeFileSync(fp, JSON.stringify(out, null, 2), 'utf8');
      return res.json({ ok: true, file: fp, fallback: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    // Create upload record first. dinas_code/uploaded_by_user_id are derived server-side from
    // the authenticated user, never trusted from the client body (same rule as elsewhere).
    const uploader = req.rdtUser.dinas;
    const uploadedBy = req.rdtUser.id;
    const originalFilename = originalFilenameTrimmed;
    const description = body.description || null; // item 6: optional free-text note on Repost submit
    const rawCount = body.rows.length;
    try {
      await client.query('BEGIN');

      // REQ-RDT-EXT-10 (4 Agu): a re-upload for a (dinas_inisiasi, periode) pair that already has
      // an ACTIVE upload must supersede it, not accumulate alongside it — lock candidates first so
      // two concurrent persists for the same dinas+period can't both pass the block-check below.
      const priorRes = await client.query(
        `SELECT id FROM rdt.uploads WHERE dinas_code=$1 AND period=$2 AND status='ACTIVE' FOR UPDATE`,
        [uploader, period]
      );
      const priorUploadIds = priorRes.rows.map((r) => r.id);
      let supersedeOutcome = { blocked: false, blockingCount: 0, blockingIds: [], supersedeIds: [] };
      if (priorUploadIds.length) {
        // has_ledger_entry, not status_konfirmasi, decides block-vs-supersede (see
        // persist/supersedeCheck.js header comment for why a status whitelist was rejected).
        const priorTxnRes = await client.query(
          `SELECT t.id, t.status_konfirmasi,
                  EXISTS (SELECT 1 FROM rdt.ledger_entries le WHERE le.transaction_id = t.id) AS has_ledger_entry
           FROM rdt.transactions t WHERE t.upload_id = ANY($1)`,
          [priorUploadIds]
        );
        supersedeOutcome = evaluateSupersede(priorTxnRes.rows);
        if (supersedeOutcome.blocked) {
          await client.query('ROLLBACK');
          if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
          return res.status(409).json({
            ok: false,
            error: `Upload sebelumnya untuk dinas ${uploader} periode ${period} (upload id ${priorUploadIds.join(', ')}) punya ${supersedeOutcome.blockingCount} transaksi yang sudah tercatat di ledger (CONFIRMED) — tidak bisa otomatis diganti. Tinjau/selesaikan transaksi tersebut secara manual dulu sebelum repost ulang periode ini.`,
            blocking_transaction_ids: supersedeOutcome.blockingIds,
            prior_upload_ids: priorUploadIds,
          });
        }
      }

      const upRes = await client.query(
        `INSERT INTO rdt.uploads (dinas_code, uploaded_by_user_id, original_filename, description, row_count_total, period) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [uploader, uploadedBy, originalFilename, description, rawCount, period]
      );
      const uploadId = upRes.rows[0].id;

      if (priorUploadIds.length) {
        await client.query(
          `UPDATE rdt.uploads SET status='SUPERSEDED', superseded_at=now(), superseded_by_upload_id=$1 WHERE id = ANY($2)`,
          [uploadId, priorUploadIds]
        );
        if (supersedeOutcome.supersedeIds.length) {
          await client.query(
            `UPDATE rdt.transactions SET status_konfirmasi='SUPERSEDED', updated_at=now() WHERE id = ANY($1)`,
            [supersedeOutcome.supersedeIds]
          );
        }
        await client.query(
          `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,NULL,$2,$3,$4,$5,$6)`,
          [uploadedBy, 'UPLOAD_SUPERSEDED', 'ACTIVE', 'SUPERSEDED', JSON.stringify({
            dinas_inisiasi: uploader,
            period,
            prior_upload_ids: priorUploadIds,
            new_upload_id: uploadId,
            superseded_transaction_count: supersedeOutcome.supersedeIds.length,
          }), req.ip]
        );
      }

      // REQ-RDT-EXT-08: save the original workbook byte-for-byte (if the client attached one)
      // and link it to this upload row, so REQ-RDT-LEDGER-09's download-with-live-formulas has
      // something to serve. TODO: no retention/cleanup policy yet — original files accumulate
      // in uploadDir indefinitely; fine for now, revisit before this holds real volume.
      if (req.file) {
        const originalFilePath = saveOriginalFile(uploadDir, uploadId, req.file.path, originalFilename || req.file.originalname);
        await client.query('UPDATE rdt.uploads SET original_file_path=$1 WHERE id=$2', [originalFilePath, uploadId]);
      }

      // REQ-RDT-EXT-03: duplicate transaction detection (cross-upload only — see
      // src/persist/duplicateCheck.js for why within-file matches are intentionally excluded).
      const pendingDocNos = Array.from(new Set(
        body.rows
          .filter((r) => r.status_konfirmasi === 'PENDING' && r.document_no !== null && r.document_no !== undefined && String(r.document_no).trim() !== '')
          .map((r) => String(r.document_no).trim())
      ));
      let existingRows = [];
      if (pendingDocNos.length > 0) {
        const dupRes = await client.query(
          `SELECT id, upload_id, document_no, ref_doc, account, cost_ctr, profit_ctr, item, in_pclc, dinas_target
           FROM rdt.transactions WHERE document_no = ANY($1::text[])`,
          [pendingDocNos]
        );
        existingRows = dupRes.rows;
      }
      const rowsToInsert = flagDuplicates(body.rows, existingRows);

      // Batch insert rows linked to uploadId
      const cols = [
        'upload_id','dinas_inisiasi','dinas_target','nominal','category','status_konfirmasi','is_reversal','invalid_reason',
        // 53 contract columns (subset shown in schema order)
        'account','cost_ctr','profit_ctr','partner_pc','document_no','ref_doc','period','text_desc','acc_text','sap_user',
        'sales_doc','wbs_elem','purch_doc','order_no','fiscal_year','elim_prctr','obj_class','customer','vendor','plant',
        'material','time_val','year_2','ref_org_un','val_a','mvt','type','sales_ord','s_no','bus_a','func_area','acty',
        'asset','rep_mat','ar','dt','ref_tran','item','bill_t','sd_doc','s_grp','s_off','co_ar','in_pclc','curr',
        'doc_date','pstng_date','in_ccc','in_tc','qty','unit','entry_dte','value_date',
        // trailing fields
        // REQ-RDT-NAV-04 (diperluas 1 Agu, ditegaskan 3 Agu): sub_group now persists (migration
        // 011) so it survives past this Repost step into Confirmation/Need Approval/history
        // previews too, not just the pre-persist Review screen.
        // reviewer_note now persists too (migration 015, 5 Agu project owner confirmation) — same
        // gap, same fix: it used to be stripped by the frontend before this request even arrived
        // (see transaction.model.ts), so Confirmation's sticky "Notes" column had nothing real to
        // pin and fell back to showing `remark` instead, which is a completely different field
        // (raw Excel routing text, not the uploader's own note).
        'sheet_name','raw_row_index','remark','raw_payload','sub_group','reviewer_note'
      ];
      // helper to normalize value for insert (explicit null check)
      const v = (x) => (x === undefined ? null : x === null ? null : x);
      function rowValsFor(r) {
        const isReversal = (r.nominal !== null && r.nominal !== undefined && Number(r.nominal) < 0) ? true : false;
        const rowVals = [];
        for (const col of cols) {
          switch (col) {
            case 'upload_id': rowVals.push(uploadId); break;
            case 'dinas_inisiasi': rowVals.push(v(r.dinas_inisiasi)); break;
            case 'dinas_target': rowVals.push(v(r.dinas_target)); break;
            case 'nominal': rowVals.push((r.nominal === null || r.nominal === undefined) ? null : r.nominal); break;
            case 'category': rowVals.push(v(r.category)); break;
            case 'status_konfirmasi': rowVals.push(v(r.status_konfirmasi)); break;
            case 'is_reversal': rowVals.push(isReversal); break;
            case 'invalid_reason': rowVals.push(v(r.reason_if_invalid)); break;
            case 'sheet_name': rowVals.push(v(r.sheet)); break;
            case 'raw_row_index': rowVals.push(v(r.row)); break;
            case 'remark': rowVals.push(v(r.remark)); break;
            case 'raw_payload': rowVals.push(v(JSON.stringify(r.raw_payload || {}))); break;
            // contract columns
            default: rowVals.push(v(r[col])); break;
          }
        }
        return rowVals;
      }

      // PostgreSQL's wire protocol caps bind parameters at 65535 per query. A single
      // multi-row INSERT with 65 columns can only fit ~1000 rows before hitting that limit —
      // a real monthly file (e.g. 8373 rows) blows way past it in one statement. Chunk the
      // insert instead; each chunk is still part of the same BEGIN...COMMIT, so the whole
      // persist stays atomic even though it's multiple INSERT statements on the wire.
      const CHUNK_SIZE = Math.max(1, Math.floor(60000 / cols.length));
      // Collected across chunks so the description-comment step below (item: "keterangan Repost
      // auto muncul di comment DT") knows which (dinas_inisiasi, dinas_target) pairs this upload
      // actually touched, and has a real transaction id to anchor each pair's comment to.
      const insertedRows = [];
      for (let start = 0; start < rowsToInsert.length; start += CHUNK_SIZE) {
        const chunk = rowsToInsert.slice(start, start + CHUNK_SIZE);
        if (!chunk.length) continue;
        const values = [];
        const placeholders = [];
        let idx = 1;
        for (const r of chunk) {
          const rowVals = rowValsFor(r);
          values.push(...rowVals);
          const place = rowVals.map(() => `$${idx++}`);
          placeholders.push(`(${place.join(',')})`);
        }
        const insertText = `INSERT INTO rdt.transactions(${cols.join(',')}) VALUES ${placeholders.join(',')} RETURNING id, dinas_inisiasi, dinas_target`;
        const insertRes = await client.query(insertText, values);
        insertedRows.push(...insertRes.rows);
      }

      // Project owner request (25 Jul): the repost description, if given, should auto-appear as
      // a comment in EVERY dinas pair's Dashboard-Detailing thread this upload actually targets —
      // one top-level comment per distinct dinas_target, anchored to one of this upload's own
      // transaction rows for that pair (same anchoring convention as dashboard.js's comment
      // routes). Skip pairs with no real target (dinas_target null) or that are self-repost
      // (EXCLUDED rows still carry dinas_target=uploader; excluded here as a pair, not a status
      // filter, so this stays correct even if EXCLUDED's definition ever changes).
      const trimmedDescription = description && String(description).trim();
      if (trimmedDescription) {
        const pairTransactionId = new Map();
        for (const r of insertedRows) {
          if (!r.dinas_target) continue;
          if (String(r.dinas_target).toUpperCase() === String(r.dinas_inisiasi).toUpperCase()) continue;
          if (!pairTransactionId.has(r.dinas_target)) pairTransactionId.set(r.dinas_target, r.id);
        }
        // REQ-RDT-COMMENT-03 (diperluas 3 Agu, gap found in sweep): this comment never notified
        // ANYONE before — not even the target dinas it's addressed to, let alone anyone @mentioned
        // in it. dashboard.js's plain manual-comment endpoint already does mention-based notify;
        // this is that same rule (resolveMentionedUserIds), applied here too — one target dinas's
        // PIC(s) implicitly (this comment IS addressed to them) plus anyone else @mentioned.
        const directory = await loadDirectory();
        for (const [targetDinas, transactionId] of pairTransactionId) {
          const commentRes = await client.query(
            `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body) VALUES ($1, NULL, $2, $3) RETURNING id`,
            [transactionId, uploadedBy, trimmedDescription]
          );
          const commentId = commentRes.rows[0].id;
          // Privacy bug fix (4 Agu, mentionRules.js's filterMentionsToPair header comment): this
          // loop creates ONE comment per distinct target dinas from the SAME shared description —
          // a mention elsewhere in that text (e.g. a different pair's dinas) must not leak into
          // THIS pair's recipient list.
          const mentioned = filterMentionsToPair(resolveMentionedUserIds(trimmedDescription, directory), directory, [uploader, targetDinas]);
          const recipientIds = new Set(mentioned);
          Object.keys(directory).forEach((id) => {
            if (String(directory[id].dinas).toUpperCase() === String(targetDinas).toUpperCase()) recipientIds.add(id);
          });
          recipientIds.delete(uploadedBy);
          for (const recipientId of recipientIds) {
            await client.query('INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)', [recipientId, commentId]);
          }
        }
      }

      await client.query('COMMIT');
      const duplicatesFlagged = rowsToInsert.filter((r, i) => r.status_konfirmasi === 'NEEDS_REVIEW' && body.rows[i].status_konfirmasi === 'PENDING').length;
      return res.json({
        ok: true,
        inserted: rowsToInsert.length,
        upload_id: uploadId,
        duplicates_flagged: duplicatesFlagged,
        superseded_upload_ids: priorUploadIds,
        superseded_transaction_count: supersedeOutcome.supersedeIds.length,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      // If the failure happened before saveOriginalFile() ran, the temp file is still sitting
      // at its original multer path — clean it up. If it already got renamed, this is a no-op.
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
      const category = await logRollbackAudit(client, { userId: uploadedBy, req, err, route: req.originalUrl });
      return res.status(500).json({ ok: false, error: String(err), error_category: category });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  } finally {
    try { await client.end(); } catch (e) { }
  }
});

app.use('/api/confirmation', confirmationRouter);
app.use('/api/declined', reassignmentRouter);
app.use('/api/export-batches', exportBatchesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/investigation', investigationRouter);
app.use('/api/share-cost', shareCostRouter);
app.use('/api/period-deadlines', periodDeadlinesRouter);

// Bug fix (live testing, 24 Jul): multer/busboy errors (e.g. MulterError on a field exceeding
// its size limit) are thrown INSIDE the upload.single(...) middleware, before any route
// handler's own try/catch runs — with no error-handling middleware registered, Express fell
// through to its default handler, which for a stream-level abort like this manifested as a
// hung connection (client saw "Memproses..." forever) rather than a readable error. This must
// be the LAST app.use — Express only routes to a 4-arg middleware for errors passed via next(err).
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  const status = err.name === 'MulterError' ? 413 : 500;
  res.status(status).json({ ok: false, error: err.message || String(err) });
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  // Run migrations (if configured) outside request handlers, then start server
  const { runMigrations } = require('./migrate');
  runMigrations().then(() => {
    app.listen(PORT, () => console.log(`RDT demo backend listening on http://localhost:${PORT}`));
  }).catch((err) => {
    console.error('Migration failed, aborting start', err);
    process.exit(1);
  });
}

module.exports = app;
