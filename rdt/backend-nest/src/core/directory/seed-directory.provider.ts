import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DirectoryProvider, EmployeeDirectory } from './directory.interface';

/**
 * Mode lokal: baca `employee-directory.seed.json` (comment header file itu buat konteks).
 * JANGAN dipakai di production — seam yang sama seperti DevMockIdentityProvider (core/security).
 */
@Injectable()
export class SeedDirectoryProvider implements DirectoryProvider {
  load(): Promise<EmployeeDirectory> {
    const raw = fs.readFileSync(
      path.join(__dirname, 'employee-directory.seed.json'),
      'utf8',
    );
    return Promise.resolve(JSON.parse(raw) as EmployeeDirectory);
  }
}
