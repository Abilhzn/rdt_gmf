import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { IDENTITY_PROVIDER } from './identity.interface';
import type { Identity, IdentityProvider } from './identity.interface';

export interface RequestWithIdentity extends Request {
  identity: Identity;
}

/**
 * Resolve identity sekali per request (via IdentityProvider yang aktif) dan tempelkan ke
 * `req.identity`, supaya `@CurrentUser()` dan `DinasAccessGuard` tinggal baca, bukan resolve ulang.
 */
@Injectable()
export class IdentityMiddleware implements NestMiddleware {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly provider: IdentityProvider,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    (req as RequestWithIdentity).identity = this.provider.resolve(req);
    next();
  }
}
