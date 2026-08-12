// Thin HTTP client for the data_user service (restructured out of this app 24 Jul 2026 — see
// middleware/auth.js's header comment). Kept as one module so the request shape only needs to
// change in one place if that service's contract changes. Uses Node's built-in global fetch
// (Node 18+), no extra dependency.
const DATA_USER_SERVICE_URL = process.env.DATA_USER_SERVICE_URL || 'http://localhost:4002';

// Checklist 1.1 (12 Agu): sent whenever data_user enforces INTERNAL_SERVICE_KEY (see its
// index.js) — a no-op header if that env var isn't set on data_user's side.
function internalHeaders() {
  return process.env.INTERNAL_SERVICE_KEY ? { 'X-Internal-Key': process.env.INTERNAL_SERVICE_KEY } : {};
}

async function loadDirectory() {
  const res = await fetch(`${DATA_USER_SERVICE_URL}/employees`, { headers: internalHeaders() });
  if (!res.ok) throw new Error(`data_user service error (${res.status}) loading directory`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'data_user service returned ok:false');
  return body.employees;
}

module.exports = { loadDirectory };
