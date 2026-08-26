/**
 * Single config factory read by @nestjs/config (ConfigModule.forRoot({ load: [configuration] })).
 * Semua nilai dari .env — tidak ada rahasia hardcoded di kode.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  minio: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  storage: {
    // 'filesystem' = dev (default, tanpa MinIO/Docker). 'minio' = prod/OCX.
    driver: 'filesystem' | 'minio';
    localPath: string;
  };
  identity: {
    // 'dev-mock' untuk lokal, 'ocx' saat sudah terintegrasi ke OCX
    mode: 'dev-mock' | 'ocx';
  };
  directory: {
    // 'seed' baca employee-directory.seed.json (lokal), 'ocx' saat sudah terintegrasi ke OCX
    mode: 'seed' | 'ocx';
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME ?? 'rdt',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    bucket: process.env.MINIO_BUCKET ?? 'rdt',
  },
  storage: {
    driver: process.env.STORAGE_DRIVER === 'minio' ? 'minio' : 'filesystem',
    localPath: process.env.STORAGE_LOCAL_PATH ?? './storage-dev',
  },
  identity: {
    mode: process.env.IDENTITY_MODE === 'ocx' ? 'ocx' : 'dev-mock',
  },
  directory: {
    mode: process.env.DIRECTORY_MODE === 'ocx' ? 'ocx' : 'seed',
  },
});
