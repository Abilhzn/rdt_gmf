// Centralized error logging: every 5xx response gets appended as one JSON line to logs/error.log
// (gitignored runtime data), so it survives past whatever terminal was open and stays greppable.
const fs = require('fs');
const path = require('path');
const { classifyError } = require('./rules/errorClassification');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'error.log');

function logError(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    // Logging itself failing must never break the actual request — fall back to console only.
    console.error('logger.js: failed to write error.log', err);
  }
}

// Express middleware — logs every response that finishes with a 5xx status, regardless of
// whether the route handler threw (caught by the app's own try/catch, which is the dominant
// pattern in this codebase — see routes/*.js) or called next(err). Captures the JSON body too
// (via a small res.json monkey-patch) since a bare status code alone isn't enough to debug from.
function errorLoggingMiddleware(serviceName) {
  return function (req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      res.locals.__loggedBody = body;
      return originalJson(body);
    };
    res.on('finish', () => {
      if (res.statusCode >= 500) {
        logError({
          service: serviceName,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          body: res.locals.__loggedBody,
        });
      }
    });
    next();
  };
}

// Shared by every ledger-mutating route's ROLLBACK catch block — categorizes the error and writes
// one rdt.audit_log row for the rollback (transaction_id NULL when not attributable to a single
// row). Swallows its own failures and always returns the category, so the caller can still put it
// in the HTTP response even if the DB write itself failed.
async function logRollbackAudit(client, { userId, req, err, route, transactionId = null }) {
  const category = classifyError(err);
  try {
    await client.query(
      'INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [userId || 'unknown', transactionId, 'ROLLBACK', null, null, JSON.stringify({ route, category, message: String((err && err.message) || err) }), (req && req.ip) || null]
    );
  } catch (logErr) { /* never let audit logging itself break the error response */ }
  return category;
}

module.exports = { logError, errorLoggingMiddleware, logRollbackAudit, LOG_FILE };
