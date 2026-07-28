export type DinasRole = 'PIC' | 'TAB';

export interface DirectoryEntry {
  dinas: string;
  role: DinasRole;
  display_name: string;
}

export interface CurrentUser extends DirectoryEntry {
  id: string;
  token: string;
}
