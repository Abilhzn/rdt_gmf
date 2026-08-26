import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Identity } from './identity.interface';
import { RequestWithIdentity } from './identity.middleware';

/**
 * Ambil identity yang sudah ditempel `IdentityMiddleware`: @CurrentUser() user: Identity
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Identity => {
    const req = ctx.switchToHttp().getRequest<RequestWithIdentity>();
    return req.identity;
  },
);
