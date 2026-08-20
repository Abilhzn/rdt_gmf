/**
 * Backend server exposing the RDT API, consumed by the Angular dev-shell frontend
 * (rdt/frontend/dev-shell, `ng serve`, port 4200) — the only frontend this serves.
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
// Baseline security headers: this service is JSON API + file download/upload only, never renders
// its own HTML/script/style, so CSP is locked to 'none' as defense-in-depth. Content-Disposition
// downloads (original file, SAP export) are unaffected — CSP governs page resource loading, not
// how a browser handles a download.
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
// Every 5xx response logged to logs/error.log — see logger.js.
app.use(errorLoggingMiddleware('rdt-backend'));
// Bounds every request to SOME response even if the handler hangs (stuck DB query, unreachable
// upstream). 30s is generous (a >300-row SAP export still finishes well under that). Paired with
// the Angular TimeoutInterceptor (same 30s) so the client-side wait is bounded even if this
// server-side timer somehow doesn't fire.
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

// Loads mapping/exclusions/dinasCodes from the DB when configured, so parseExcelFile reflects
// what TAB actually edited via PUT /api/mapping and PUT /api/exclusions. Returns null (caller
// falls back to the JSON seed files) when no DB.
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
// fieldSize default (1MB) is too small for /api/persist's `rows` field — the full parsed row set
// (incl. raw_payload per row) re-sent as JSON text comfortably exceeds 1MB for a real dinas file.
// Busboy aborts the connection non-gracefully on overflow — see the global error handler below
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
    // Pass DB-sourced mapping/exclusions/dinasCodes when configured, so TAB's Admin UI edits take
    // effect. `null` when no DB — parseExcelFile falls back to the JSON seed files.
    const dbConfig = await loadDbRoutingConfig();
    const rows = await parseExcelFile(fp, { uploaderDinas, ...(dbConfig || {}) });
    // Zero rows here means every sheet in the workbook was skipped (pivot/lookup-shaped, or
    // missing the required headers) — a real file with data rows always produces at least SOME
    // row, so surface this as an explicit error rather than a silent empty success.
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

// The Angular dev-shell (rdt/frontend/dev-shell, `ng serve`, port 4200) is the only frontend —
// this server is API-only.
app.get('/', (req, res) => res.json({ ok: true, service: 'rdt-backend', frontend: 'http://localhost:4200/rdt' }));

// Round-trips the database so "service up but DB unreachable" shows up as db:"error" here instead
// of masquerading as a healthy service that then 500s on every real request. No auth required —
// a liveness probe has to be reachable without a login.
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
// notification author display names. Proxies to the data_user service instead of reading a
// local file (see middleware/auth.js for why identity/directory data lives outside this app).
app.get('/api/directory', requireUser, async (req, res) => {
  try {
    res.json({ ok: true, directory: await loadDirectory() });
  } catch (err) {
    res.status(502).json({ ok: false, error: `Gagal menghubungi data_user service: ${err.message}` });
  }
});

// GET /api/contract-fields — exposes CONTRACT_FIELDS (excelParser.js, same list exportBatches.js
// uses to build the SAP file) so the Angular Repost Review preview table renders the same columns
// that actually get repost-ed, instead of a second hand-picked list that could drift out of sync.
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

// GET/PUT mapping — TAB-only. Angular's admin/ module has no route guard of its own, so the
// backend is the real enforcement layer here, not the frontend.
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

// GET/PUT exclusions — same TAB-only gate as /api/mapping above.
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
// Legacy no-DB fallback path, no caller left in the frontend but still reachable directly —
// gated same as everything else rather than left as an unauthenticated write endpoint.
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
// The client may attach the original workbook (field "file") so its bytes can be saved alongside
// the parsed rows — multer no-ops on a plain JSON request, so existing JSON-only callers are
// unaffected. On multipart requests, non-file fields arrive as strings, hence the JSON.parse below.
app.post('/api/persist', requireUser, upload.single('file'), async (req, res) => {
  const body = req.body || {};
  // rows/aggregation arrive as JSON-encoded form fields (multipart, alongside the file) — malformed
  // JSON here used to throw uncaught out of the route handler and crash the whole process, not just
  // fail this one request. Parse defensively, same clean-400 pattern the rest of this route uses.
  let rows;
  try {
    rows = typeof body.rows === 'string' ? JSON.parse(body.rows) : body.rows;
  } catch (e) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e2) {} }
    return res.status(400).json({ ok: false, error: 'invalid rows: not valid JSON' });
  }
  if (!Array.isArray(rows)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    return res.status(400).json({ ok: false, error: 'invalid body, expected { rows: [] }' });
  }
  body.rows = rows;
  try {
    body.aggregation = typeof body.aggregation === 'string' ? JSON.parse(body.aggregation) : body.aggregation;
  } catch (e) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e2) {} }
    return res.status(400).json({ ok: false, error: 'invalid aggregation: not valid JSON' });
  }

  // Periode tidak diminta dari client — selalu implisit = bulan sebelum bulan upload berjalan
  // (server time), lihat rules/periodEffective.js's currentAutoPeriode.
  const period = currentAutoPeriode();

  // rdt.uploads.original_filename is NOT NULL in the schema — reject early with a clean 400
  // instead of a raw Postgres constraint-violation 500.
  const originalFilenameTrimmed = typeof body.original_filename === 'string' ? body.original_filename.trim() : '';
  if (!originalFilenameTrimmed) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    return res.status(400).json({ ok: false, error: 'original_filename is required' });
  }

  // description (level upload) and each row's reviewer_note (per-baris) are length-checked here.
  // All-or-nothing: one row's reviewer_note too long rejects the whole persist call (no
  // partial-write half-state).
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

      // A re-upload for a (dinas_inisiasi, periode) pair that already has an ACTIVE upload must
      // supersede it, not accumulate alongside it — lock candidates first so two concurrent
      // persists for the same dinas+period can't both pass the block-check below.
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

      // Save the original workbook byte-for-byte (if the client attached one) and link it to this
      // upload row, so download-with-live-formulas has something to serve.
      // TODO: no retention/cleanup policy yet — original files accumulate in uploadDir indefinitely.
      if (req.file) {
        const originalFilePath = saveOriginalFile(uploadDir, uploadId, req.file.path, originalFilename || req.file.originalname);
        await client.query('UPDATE rdt.uploads SET original_file_path=$1 WHERE id=$2', [originalFilePath, uploadId]);
      }

      // Duplicate transaction detection (cross-upload only — see persist/duplicateCheck.js).
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
        // trailing fields — sub_group and reviewer_note persist here so they survive past this
        // Repost step into Confirmation/Need Approval/history previews too.
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

      // The repost description, if given, auto-appears as a comment in every dinas pair's
      // Dashboard-Detailing thread this upload actually targets — one top-level comment per
      // distinct dinas_target, anchored to one of this upload's own transaction rows for that
      // pair. Skips pairs with no real target or that are self-repost (EXCLUDED rows still carry
      // dinas_target=uploader).
      const trimmedDescription = description && String(description).trim();
      if (trimmedDescription) {
        const pairTransactionId = new Map();
        for (const r of insertedRows) {
          if (!r.dinas_target) continue;
          if (String(r.dinas_target).toUpperCase() === String(r.dinas_inisiasi).toUpperCase()) continue;
          if (!pairTransactionId.has(r.dinas_target)) pairTransactionId.set(r.dinas_target, r.id);
        }
        // Notifies the target dinas's PIC(s) implicitly (this comment is addressed to them) plus
        // anyone else @mentioned, same mention-based notify rule as dashboard.js's manual-comment endpoint.
        const directory = await loadDirectory();
        for (const [targetDinas, transactionId] of pairTransactionId) {
          const commentRes = await client.query(
            `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body) VALUES ($1, NULL, $2, $3) RETURNING id`,
            [transactionId, uploadedBy, trimmedDescription]
          );
          const commentId = commentRes.rows[0].id;
          // This loop creates one comment per distinct target dinas from the same shared
          // description — a mention elsewhere in that text must not leak into this pair's
          // recipient list (see mentionRules.js's filterMentionsToPair).
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

// Catches multer/busboy errors (e.g. MulterError on a field exceeding its size limit), thrown
// inside upload.single(...) before any route handler's own try/catch runs. Must be the LAST
// app.use — Express only routes to a 4-arg middleware for errors passed via next(err).
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
