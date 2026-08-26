// Parses @mentions out of a comment body and resolves them to the user_ids that should be
// notified. Separated from routes/dashboard.js so it's unit-testable without a DB connection.
//
// Two mention forms: a specific user_id (@demo-pic-tj) or a dinas code (@TJ) — a dinas mention
// fans out to every directory entry whose `dinas` matches. Purely for notification targeting,
// never changes transaction state.

// Directory shape (DirectoryEntry/EmployeeDirectory) lives in core/directory — dipakai juga oleh
// DirectoryProvider (Batch 3b), bukan cuma modul ini.
import type { EmployeeDirectory } from '../../../core/directory/directory.interface';
export type {
  DirectoryEntry,
  EmployeeDirectory,
} from '../../../core/directory/directory.interface';

export function extractMentionTokens(body: unknown): string[] {
  const text = typeof body === 'string' ? body : '';
  const matches = text.match(/@([\w-]+)/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

// directory: the employee-directory.seed.json shape, { user_id: { dinas, role, display_name } }.
// TA is its own dinas with its own PIC, distinct from TAB — no alias between them.
export function resolveMentionedUserIds(
  body: unknown,
  directory: EmployeeDirectory,
): string[] {
  const tokens = extractMentionTokens(body);
  const userIds = new Set<string>();
  for (const token of tokens) {
    if (directory[token]) {
      userIds.add(token);
      continue;
    }
    const tokenUpper = token.toUpperCase();
    Object.keys(directory).forEach((id) => {
      if (String(directory[id].dinas).toUpperCase() === tokenUpper)
        userIds.add(id);
    });
  }
  return Array.from(userIds);
}

// Privacy fix: a broadcast description that @mentions multiple dinas (e.g. touching both TA and
// TMM) creates one comment per pair, but resolveMentionedUserIds resolves the whole shared text
// each time — so a mention would leak onto a pair it doesn't belong to. Every mentioned user must
// belong to the pair the comment is actually anchored to (or be TAB, who oversees every pair)
// before being added as a recipient; this has to happen at recipient-selection time, not query time.
export function filterMentionsToPair(
  userIds: string[],
  directory: EmployeeDirectory,
  allowedDinasCodes: Array<string | null | undefined>,
): string[] {
  const allowedUpper = new Set(
    allowedDinasCodes.filter(Boolean).map((d) => String(d).toUpperCase()),
  );
  return userIds.filter((id) => {
    const entry = directory[id];
    if (!entry) return false;
    if (entry.role === 'TAB') return true;
    return allowedUpper.has(String(entry.dinas).toUpperCase());
  });
}
