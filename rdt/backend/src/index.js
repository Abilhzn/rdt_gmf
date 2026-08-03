/**
 * Minimal backend server to expose parser endpoint for RDT module.
 * - POST /api/parse  : accepts multipart/form-data with field `file` and returns parsed rows + aggregation
 * - GET  /rdt/demo  : serves a simple demo UI to upload Excel and preview parsed results
 *
 * This server is intentionally minimal for demo purposes; in production this should be
 * integrated into the team's existing Node.js backend with proper auth, logging, and error handling.
 */

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { parseExcelFile, CONTRACT_FIELDS } = require('./parser/excelParser');
const { flagDuplicates } = require('./persist/duplicateCheck');
const { saveOriginalFile } = require('./persist/originalFile');
const confirmationRouter = require('./routes/confirmation');
const reassignmentRouter = require('./routes/reassignment');
const exportBatchesRouter = require('./routes/exportBatches');
const dashboardRouter = require('./routes/dashboard');
const uploadsRouter = require('./routes/uploads');
const notificationsRouter = require('./routes/notifications');
const investigationRouter = require('./routes/investigation');
const shareCostRouter = require('./routes/shareCost');
const { requireUser } = require('./middleware/auth');
const { loadDirectory } = require('./dataUserClient');
const { resolveMentionedUserIds } = require('./rules/mentionRules');
const { Client } = require('pg');

const app = express();
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
    const rows = await parseExcelFile(fp, { uploaderDinas });
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

// Serve demo UI static file (bundled under backend/src/frontend/rdt)
// Root URL diarahkan ke demo supaya localhost:4000 langsung menampilkan UI.
app.get('/', (req, res) => res.redirect('/rdt/demo'));
app.get('/rdt/demo', (req, res) => {
  const demo = path.join(__dirname, 'frontend', 'rdt', 'ui-demo.html');
  if (!fs.existsSync(demo)) return res.status(404).send('demo not found');
  res.sendFile(demo);
});
app.use('/rdt/assets', express.static(path.join(__dirname, 'frontend', 'rdt', 'assets')));

// GET /api/directory — employee directory, used for the @mention autocomplete + comment/
// notification author display names. Restructured 24 Jul 2026: proxies to the data_user
// service instead of reading a local file (see rdt/backend/src/middleware/auth.js's header
// comment for why identity/directory data moved out of this app).
app.get('/api/directory', async (req, res) => {
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
app.get('/api/contract-fields', (req, res) => {
  res.json({ ok: true, fields: CONTRACT_FIELDS.map((f) => ({ key: f.key, label: f.variants[0] })) });
});

// GET /api/dinas — list of active dinas codes (for reassignment target pickers etc.)
app.get('/api/dinas', (req, res) => {
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

// GET/PUT mapping
app.get('/api/mapping', (req, res) => {
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

app.put('/api/mapping', express.json(), (req, res) => {
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

// GET/PUT exclusions
app.get('/api/exclusions', (req, res) => {
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

app.put('/api/exclusions', express.json(), (req, res) => {
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
app.post('/api/commit', express.json(), (req, res) => {
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

  // REQ-RDT-SAP-13 (3 Agu): the dinas pengaju must explicitly state which month/year this DT is
  // FOR — never inferred from the upload/repost timestamp (that's the bug this requirement fixes:
  // a June DT re-posted in August used to archive under August). "YYYY-MM" from an
  // <input type="month">, validated here rather than trusted as freeform text.
  const period = typeof body.period === 'string' ? body.period.trim() : '';
  if (!/^\d{4}-\d{2}$/.test(period)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    return res.status(400).json({ ok: false, error: 'period is required, format YYYY-MM' });
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
    const originalFilename = body.original_filename || null;
    const description = body.description || null; // item 6: optional free-text note on Repost submit
    const rawCount = body.rows.length;
    try {
      await client.query('BEGIN');
      const upRes = await client.query(
        `INSERT INTO rdt.uploads (dinas_code, uploaded_by_user_id, original_filename, description, row_count_total, period) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [uploader, uploadedBy, originalFilename, description, rawCount, period]
      );
      const uploadId = upRes.rows[0].id;

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
        'sheet_name','raw_row_index','remark','raw_payload','sub_group'
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
          const recipientIds = new Set(resolveMentionedUserIds(trimmedDescription, directory));
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
      return res.json({ ok: true, inserted: rowsToInsert.length, upload_id: uploadId, duplicates_flagged: duplicatesFlagged });
    } catch (err) {
      await client.query('ROLLBACK');
      // If the failure happened before saveOriginalFile() ran, the temp file is still sitting
      // at its original multer path — clean it up. If it already got renamed, this is a no-op.
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
      return res.status(500).json({ ok: false, error: String(err) });
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
