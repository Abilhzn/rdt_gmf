import { Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { DirectoryProvider, EmployeeDirectory } from './directory.interface';

/**
 * Placeholder: directory karyawan sebenarnya dari OCX (sama seperti OcxIdentityProvider,
 * core/security). Belum ada integrasi nyata — di luar scope Batch 3b.
 */
@Injectable()
export class OcxDirectoryProvider implements DirectoryProvider {
  load(): Promise<EmployeeDirectory> {
    throw new DomainError(
      'Directory OCX belum terintegrasi',
      501,
      'DIRECTORY_NOT_IMPLEMENTED',
    );
  }
}
