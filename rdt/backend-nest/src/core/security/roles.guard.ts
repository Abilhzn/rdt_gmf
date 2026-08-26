import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../errors/domain-error';
import { ROLES_KEY } from './roles.decorator';
import { RequestWithIdentity } from './identity.middleware';

/**
 * Baca role dari `req.identity` (IdentityProvider Batch 0) dan bandingkan ke `@Roles(...)`
 * di handler/controller. Tanpa `@Roles()` → lolos (pakai guard lain kalau cuma butuh
 * "user login", mis. `DinasAccessGuard`).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithIdentity>();
    if (!req.identity || !requiredRoles.includes(req.identity.role)) {
      throw new DomainError(
        `Forbidden: requires role ${requiredRoles.join(' or ')}`,
        403,
        'FORBIDDEN_ROLE',
      );
    }
    return true;
  }
}
