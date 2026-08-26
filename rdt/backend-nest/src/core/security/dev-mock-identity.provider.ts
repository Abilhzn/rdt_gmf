import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Identity, IdentityProvider } from './identity.interface';

/**
 * Mode lokal: baca identity palsu dari header request (fallback ke default kalau tidak ada),
 * supaya bisa jalan tanpa OCX. JANGAN dipakai di production (lihat `IDENTITY_MODE` di .env).
 */
@Injectable()
export class DevMockIdentityProvider implements IdentityProvider {
  resolve(req: Request): Identity {
    return {
      userId: (req.header('x-dev-user-id') as string) ?? 'dev-user',
      dinas: (req.header('x-dev-dinas') as string) ?? 'DEV',
      role: (req.header('x-dev-role') as string) ?? 'staff',
    };
  }
}
