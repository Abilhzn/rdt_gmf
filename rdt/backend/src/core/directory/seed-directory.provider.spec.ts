import { SeedDirectoryProvider } from './seed-directory.provider';

describe('SeedDirectoryProvider', () => {
  test('loads employee-directory.seed.json as { user_id: { dinas, role, display_name } }', async () => {
    const directory = await new SeedDirectoryProvider().load();
    expect(directory['demo-tab']).toEqual({
      dinas: 'TAB',
      role: 'TAB',
      display_name: 'TAB (demo)',
    });
    expect(directory['demo-pic-tj'].dinas).toBe('TJ');
    expect(directory['demo-pic-tj'].role).toBe('PIC');
  });
});
