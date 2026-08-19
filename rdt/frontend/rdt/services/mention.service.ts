import { Injectable } from '@angular/core';
import { CurrentUserService } from '@auth/services/current-user.service';
import { DinasService } from './dinas.service';

export interface MentionOption {
  /** what actually gets inserted after "@" — must stay a single \w-ish token, no spaces */
  token: string;
  /** what's shown in the dropdown so entries are distinguishable */
  label: string;
}

// Satu implementasi @mention dipakai ulang di semua field notes/deskripsi, bukan ditulis beda-beda
// per tempat. Single source of mentionable options (dinas + directory users) and the single
// resolution rule for turning a raw "@token" into a real account — mirrors backend's
// rules/mentionRules.js's resolveMentionedUserIds (a token is either a literal directory user_id,
// or a dinas code that fans out — here we just need "is this real", so we resolve to ONE display
// label rather than a user_id list).
@Injectable({ providedIn: 'root' })
export class MentionService {
  mentionOptions: MentionOption[] = [];
  private directory: Record<string, { dinas: string; role: string; display_name: string }> = {};

  constructor(dinasService: DinasService, currentUser: CurrentUserService) {
    dinasService.getActiveDinas().subscribe((dinasList) => {
      const dinasOptions: MentionOption[] = dinasList.map((d) => ({ token: d.code, label: `${d.code} — ${d.name}` }));
      this.mentionOptions = [...dinasOptions, ...this.mentionOptions.filter((o) => !dinasOptions.some((d) => d.token === o.token))];
    });
    currentUser.loadDirectory().subscribe((directory) => {
      this.directory = directory;
      const userOptions: MentionOption[] = Object.entries(directory).map(([id, entry]) => ({ token: id, label: `${entry.display_name} (${entry.dinas})` }));
      this.mentionOptions = [...this.mentionOptions, ...userOptions];
    });
  }

  suggestionsFor(query: string): MentionOption[] {
    const q = query.toLowerCase();
    return this.mentionOptions
      .filter((o) => o.token.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
      .slice(0, 20);
  }

  // Same two-form resolution as mentionRules.js's resolveMentionedUserIds: a literal directory
  // user_id, or a dinas code (case-insensitive) matched against mentionOptions' dinas entries.
  // Returns null for a token that doesn't resolve to anything real — that's how the caller knows
  // to render it as plain text instead of a linked chip.
  resolve(token: string): { label: string } | null {
    const entry = this.directory[token];
    if (entry) return { label: `${entry.display_name} (${entry.dinas})` };
    const upper = token.toUpperCase();
    const dinasMatch = this.mentionOptions.find((o) => o.token.toUpperCase() === upper);
    return dinasMatch ? { label: dinasMatch.label } : null;
  }
}
