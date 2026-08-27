import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { RequestWithIdentity } from './identity.middleware';

/**
 * Batch 3: implementasi nyata (Batch 0 cuma skeleton "req.identity ada?"). Port
 * `middleware/auth.js`'s `requireDinasAccess('dinas')`:
 * - Tidak ada identity -> 401.
 * - role TAB -> boleh dinas apa pun (termasuk Corp, yang tak punya PIC sendiri).
 * - Selain itu: identity.dinas harus sama (case-insensitive) dengan param `:dinas` -> 403 kalau beda.
 */
@Injectable()
export class DinasAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithIdentity>();
    if (!req.identity) {
      throw new DomainError('Authentication required', 401, 'UNAUTHENTICATED');
    }
    if (req.identity.role === 'TAB') return true;
    const targetDinas = String(req.params.dinas ?? '').toUpperCase();
    if (String(req.identity.dinas).toUpperCase() === targetDinas) return true;
    throw new DomainError(
      `user ${req.identity.userId} (dinas=${req.identity.dinas}, role=${req.identity.role}) not authorized for dinas=${targetDinas}`,
      403,
      'FORBIDDEN_DINAS',
    );
  }
}
