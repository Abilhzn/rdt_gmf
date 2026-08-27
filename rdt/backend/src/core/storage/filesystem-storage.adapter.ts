import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import storageConfig from './storage.config';
import { StorageService } from './storage.service';

/**
 * Dev adapter: simpan objek sebagai file biasa di folder lokal (`STORAGE_LOCAL_PATH`,
 * default `./storage-dev`). Tidak butuh MinIO/Docker. `objectName` boleh mengandung `/` —
 * dibuat sebagai subfolder.
 */
@Injectable()
export class FilesystemStorageAdapter implements StorageService {
  private readonly root: string;

  constructor(
    @Inject(storageConfig.KEY) config: ConfigType<typeof storageConfig>,
  ) {
    this.root = path.resolve(config.localPath);
  }

  private resolvePath(objectName: string): string {
    return path.join(this.root, objectName);
  }

  async putObject(objectName: string, data: Buffer): Promise<void> {
    const filePath = this.resolvePath(objectName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  getObject(objectName: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(objectName));
  }

  async objectExists(objectName: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(objectName));
      return true;
    } catch {
      return false;
    }
  }
}
