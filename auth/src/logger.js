// Checklist 2.2 (12 Agu) — centralized error logging. Doesn't need to be Sentry (checklist's own
// words), just needs to exist: a dev/TAB checking this service after something goes wrong should
// find every 5xx response logged here, not have to wait for a user to report it or dig through a
// terminal window that's long since scrolled away. Appends one JSON line per error to
// logs/error.log (gitignored — runtime data, not source, same treatment as staging/uploads
// dirs — see root .gitignore) so it survives past whatever terminal happened to be open when it
// occurred and stays greppable.
const fs = require('fs');
const path = require('path');

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

module.exports = { logError, errorLoggingMiddleware, LOG_FILE };
