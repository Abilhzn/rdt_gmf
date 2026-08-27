import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Pasang di handler/controller: `@Roles('TAB')`. Dibaca `RolesGuard`. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
