import { DatabaseService } from './database.service';

// Mock `pg` supaya kita bisa kontrol client.query/release tanpa DB nyata (lihat health.controller.spec.ts
// untuk pola serupa -- di sini butuh mock Pool krn withTransaction pakai pool.connect(), bukan pool.query()).
jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      connect: jest.fn(),
    })),
    // database.service.ts calls types.setTypeParser(20, ...) at module load (top-level, once) --
    // needs a stub or the mock module has no `types` export at all.
    types: { setTypeParser: jest.fn() },
  };
});

type FakeClient = {
  query: jest.Mock;
  release: jest.Mock;
};

describe('DatabaseService.withTransaction', () => {
  function makeService(client: FakeClient) {
    const service = new DatabaseService({
      host: 'x',
      port: 5432,
      database: 'x',
      user: 'x',
      password: 'x',
    });
    // @ts-expect-error -- akses private pool utk suntik fake client, hindari bikin real Pool.
    (service.pool.connect as jest.Mock) = jest.fn().mockResolvedValue(client);
    return service;
  }

  function makeClient(): FakeClient {
    return {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
  }

  it('happy path: BEGIN -> fn -> COMMIT, release() tanpa error', async () => {
    const client = makeClient();
    const service = makeService(client);

    const result = await service.withTransaction(() => Promise.resolve('done'));

    expect(result).toBe('done');
    expect(client.query.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'BEGIN',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('fn throws: ROLLBACK dijalankan, error asli tetap dilempar, release() tanpa error', async () => {
    const client = makeClient();
    const service = makeService(client);
    const boom = new Error('boom');

    await expect(
      service.withTransaction(() => Promise.reject(boom)),
    ).rejects.toBe(boom);

    expect(client.query.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledWith(boom);
  });

  it('ROLLBACK itu sendiri gagal: error ASLI (bukan rollback error) yang dilempar, client.release(err) dipanggil supaya pool membuang koneksi', async () => {
    const client = makeClient();
    const rollbackErr = new Error('connection terminated');
    client.query.mockImplementation((sql: string) => {
      if (sql === 'ROLLBACK') return Promise.reject(rollbackErr);
      return Promise.resolve({ rows: [] });
    });
    const service = makeService(client);
    const originalErr = new Error('original failure');

    await expect(
      service.withTransaction(() => Promise.reject(originalErr)),
    ).rejects.toBe(originalErr);

    expect(client.release).toHaveBeenCalledWith(originalErr);
  });
});
