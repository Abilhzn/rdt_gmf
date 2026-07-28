// Thin HTTP client for the data_user service — kept as one tiny module so the request shape
// (base URL, error handling) only needs to change in one place if that service's contract ever
// changes. Uses Node's built-in global fetch (Node 18+), no extra dependency.
const DATA_USER_URL = process.env.DATA_USER_URL || 'http://localhost:4002';

async function getEmployee(userId) {
  const res = await fetch(`${DATA_USER_URL}/employees/${encodeURIComponent(userId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`data_user service error (${res.status}) looking up ${userId}`);
  const body = await res.json();
  return body.employee;
}

module.exports = { getEmployee };
