// Single source of truth for backend's base path. `backend` has no global prefix
// (`main.ts` — controllers sit at root, e.g. `@Controller('repost/upload')`), so `/api` here is
// purely a dev-shell proxy convention (see `dev-shell/proxy.conf.json`, which rewrites it away
// before forwarding to port 3000) — kept as `/api` to match the existing service convention
// instead of churning every service's `base` string in this batch.
export const API_BASE = '/api';
