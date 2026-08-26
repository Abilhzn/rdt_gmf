import { HealthController } from './health.controller';
import { DatabaseService } from '../core/database/database.service';

describe('HealthController', () => {
  it('reports db: ok when the query succeeds', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseService;
    const controller = new HealthController(db);
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      db: 'ok',
    });
  });

  it('reports db: unreachable when the query throws (app still up)', async () => {
    const db = {
      query: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    } as unknown as DatabaseService;
    const controller = new HealthController(db);
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      db: 'unreachable',
    });
  });
});
