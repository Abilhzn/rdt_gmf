import { registerAs } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export default registerAs('storage', (): AppConfig['storage'] => ({
  driver: process.env.STORAGE_DRIVER === 'minio' ? 'minio' : 'filesystem',
  localPath: process.env.STORAGE_LOCAL_PATH ?? './storage-dev',
}));
