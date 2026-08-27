import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { FilesystemStorageAdapter } from './filesystem-storage.adapter';
import { MinioStorageAdapter } from './minio-storage.adapter';
import minioConfig from './minio.config';
import storageConfig from './storage.config';
import { StorageService, STORAGE_SERVICE } from './storage.service';

@Module({
  imports: [
    ConfigModule.forFeature(minioConfig),
    ConfigModule.forFeature(storageConfig),
  ],
  providers: [
    FilesystemStorageAdapter,
    MinioStorageAdapter,
    {
      provide: STORAGE_SERVICE,
      useFactory: (
        config: ConfigService<AppConfig>,
        filesystem: FilesystemStorageAdapter,
        minio: MinioStorageAdapter,
      ): StorageService =>
        config.get('storage.driver', { infer: true }) === 'minio'
          ? minio
          : filesystem,
      inject: [ConfigService, FilesystemStorageAdapter, MinioStorageAdapter],
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
