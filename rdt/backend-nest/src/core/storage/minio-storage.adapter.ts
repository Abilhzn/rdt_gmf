import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as Minio from 'minio';
import minioConfig from './minio.config';
import { StorageService } from './storage.service';

/**
 * Satu-satunya tempat SDK MinIO dipanggil (Boundaries). Konsumer lain hanya kenal
 * interface `StorageService` lewat token `STORAGE_SERVICE`.
 */
@Injectable()
export class MinioStorageAdapter implements StorageService {
  private readonly client: Minio.Client;
  private readonly bucket: string;

  constructor(@Inject(minioConfig.KEY) config: ConfigType<typeof minioConfig>) {
    this.client = new Minio.Client({
      endPoint: config.endpoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    this.bucket = config.bucket;
  }

  async putObject(
    objectName: string,
    data: Buffer,
    contentType?: string,
  ): Promise<void> {
    await this.client.putObject(this.bucket, objectName, data, data.length, {
      ...(contentType ? { 'Content-Type': contentType } : {}),
    });
  }

  async getObject(objectName: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectName);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async objectExists(objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, objectName);
      return true;
    } catch {
      return false;
    }
  }
}
