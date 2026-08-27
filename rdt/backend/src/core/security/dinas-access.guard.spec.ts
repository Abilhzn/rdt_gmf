import { ExecutionContext } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { DinasAccessGuard } from './dinas-access.guard';
import { RequestWithIdentity } from './identity.middleware';

function ctxFor(req: Partial<RequestWithIdentity>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('DinasAccessGuard (port authorization.test.js requireDinasAccess)', () => {
  const guard = new DinasAccessGuard();

  test('allows a PIC to access their own dinas', () => {
    const ctx = ctxFor({
      identity: { userId: 'u1', dinas: 'TC', role: 'PIC' },
      params: { dinas: 'TC' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test('is case-insensitive when matching dinas codes', () => {
    const ctx = ctxFor({
      identity: { userId: 'u1', dinas: 'tc', role: 'PIC' },
      params: { dinas: 'TC' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test('rejects with 403 when a PIC tries to access a different dinas', () => {
    const ctx = ctxFor({
      identity: { userId: 'u1', dinas: 'TC', role: 'PIC' },
      params: { dinas: 'TF' },
    });
    try {
      guard.canActivate(ctx);
      throw new Error('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(403);
      expect((err as DomainError).errorCode).toBe('FORBIDDEN_DINAS');
    }
  });

  test('allows role TAB to access any dinas', () => {
    const ctx = ctxFor({
      identity: { userId: 'u-tab', dinas: 'TAB', role: 'TAB' },
      params: { dinas: 'TF' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test('rejects with 401 when identity was never resolved', () => {
    const ctx = ctxFor({
      params: { dinas: 'TC' },
    });
    try {
      guard.canActivate(ctx);
      throw new Error('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(401);
    }
  });

  // REQ-RDT-AUTH-04: Corp has no dedicated PIC — only role TAB may act as Corp on its behalf.
  test('allows role TAB to access dinas Corp', () => {
    const ctx = ctxFor({
      identity: { userId: 'u-tab', dinas: 'TAB', role: 'TAB' },
      params: { dinas: 'Corp' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test('rejects a plain PIC from accessing dinas Corp', () => {
    const ctx = ctxFor({
      identity: { userId: 'u1', dinas: 'TB', role: 'PIC' },
      params: { dinas: 'Corp' },
    });
    try {
      guard.canActivate(ctx);
      throw new Error('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).statusCode).toBe(403);
    }
  });
});
