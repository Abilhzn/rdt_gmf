import { HttpHandler, HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { IdentityBridgeInterceptor } from './identity-bridge.interceptor';
import { CurrentUserService } from '@auth/services/current-user.service';
import { CurrentUser } from '@auth/services/current-user.model';

describe('IdentityBridgeInterceptor', () => {
  function run(currentUser: Partial<CurrentUserService>, url: string) {
    const interceptor = new IdentityBridgeInterceptor(currentUser as CurrentUserService);
    let seen: HttpRequest<unknown> | null = null;
    const handler: HttpHandler = {
      handle: (req) => {
        seen = req;
        return of(new HttpResponse({ body: {} }));
      },
    };
    interceptor.intercept(new HttpRequest('GET', url), handler).subscribe();
    return seen as unknown as HttpRequest<unknown>;
  }

  it('stamps x-dev-* headers on requests to API_BASE when a user is logged in', () => {
    const req = run({ current: { id: 'u1', dinas: 'ABC', role: 'PIC' } as CurrentUser }, '/api/dashboard/summary');
    expect(req.headers.get('x-dev-user-id')).toBe('u1');
    expect(req.headers.get('x-dev-dinas')).toBe('ABC');
    expect(req.headers.get('x-dev-role')).toBe('PIC');
  });

  it('does not stamp headers on /auth-api or /data-api requests', () => {
    const req = run({ current: { id: 'u1', dinas: 'ABC', role: 'PIC' } as CurrentUser }, '/auth-api/login');
    expect(req.headers.has('x-dev-user-id')).toBe(false);
  });

  it('lets the request through untouched when nobody is logged in', () => {
    const req = run({ current: null }, '/api/dashboard/summary');
    expect(req.headers.has('x-dev-user-id')).toBe(false);
  });
});
