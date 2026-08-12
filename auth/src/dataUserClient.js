// Thin HTTP client for the data_user service — kept as one tiny module so the request shape
// (base URL, error handling) only needs to change in one place if that service's contract ever
// changes. Uses Node's built-in global fetch (Node 18+), no extra dependency.
const DATA_USER_URL = process.env.DATA_USER_URL || 'http://localhost:4002';

// Checklist 1.1 (12 Agu): sent whenever data_user enforces INTERNAL_SERVICE_KEY (see its
// index.js) — a no-op header if that env var isn't set on data_user's side.
function internalHeaders() {
  return process.env.INTERNAL_SERVICE_KEY ? { 'X-Internal-Key': process.env.INTERNAL_SERVICE_KEY } : {};
}

async function getEmployee(userId) {
  const res = await fetch(`${DATA_USER_URL}/employees/${encodeURIComponent(userId)}`, { headers: internalHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`data_user service error (${res.status}) looking up ${userId}`);
  const body = await res.json();
  return body.employee;
}

module.exports = { getEmployee };
