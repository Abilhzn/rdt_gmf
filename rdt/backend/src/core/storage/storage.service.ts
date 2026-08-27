/**
 * Interface storage — module lain depend ke ini, bukan ke SDK MinIO langsung (Boundaries,
 * Clean Code Bab 8). Gampang swap ke MinIO OCX nanti tanpa menyentuh caller.
 */
export interface StorageService {
  putObject(
    objectName: string,
    data: Buffer,
    contentType?: string,
  ): Promise<void>;
  getObject(objectName: string): Promise<Buffer>;
  objectExists(objectName: string): Promise<boolean>;
}

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');
