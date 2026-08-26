export interface DirectoryEntry {
  dinas: string;
  role: string;
  display_name: string;
}

// employee-directory.seed.json shape: { user_id: { dinas, role, display_name } }.
export type EmployeeDirectory = Record<string, DirectoryEntry>;

export interface DirectoryProvider {
  load(): Promise<EmployeeDirectory>;
}

export const DIRECTORY_PROVIDER = Symbol('DIRECTORY_PROVIDER');
