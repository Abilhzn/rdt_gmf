import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Port dari auth/src/logger.js's errorLoggingMiddleware — centralized error logging, gak perlu
// Sentry, cukup: tiap 5xx ke-log ke satu file, greppable, gak ilang begitu terminal ke-scroll.
// Satu baris JSON per error ke logs/error.log (gitignored — runtime data, bukan source, sama
// kayak storage-dev/).
const LOG_DIR = join(__dirname, '..', '..', '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'error.log');

export interface ErrorLogEntry {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

export function logError(entry: ErrorLogEntry): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const line =
      JSON.stringify({
        time: new Date().toISOString(),
        service: 'backend',
        ...entry,
      }) + '\n';
    appendFileSync(LOG_FILE, line);
  } catch (err) {
    // Logging itself failing must never break the actual response — fall back to console only.

    console.error('error-log.util.ts: failed to write error.log', err);
  }
}
