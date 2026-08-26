import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { DomainError } from '../errors/domain-error';
import { Identity, IdentityProvider } from './identity.interface';

/**
 * Placeholder: identity sebenarnya dari OCX (context/header yang diisi shell OCX saat
 * RDT disuntik jadi bagian dari OPEX/OCX). Belum ada integrasi nyata — di luar scope Batch 0.
 */
@Injectable()
export class OcxIdentityProvider implements IdentityProvider {
  resolve(req: Request): Identity {
    const userId = req.header('x-ocx-user-id');
    const dinas = req.header('x-ocx-dinas');
    const role = req.header('x-ocx-role');
    if (!userId || !dinas || !role) {
      throw new DomainError(
        'Identity OCX tidak ditemukan di request',
        401,
        'IDENTITY_MISSING',
      );
    }
    return { userId, dinas, role };
  }
}
