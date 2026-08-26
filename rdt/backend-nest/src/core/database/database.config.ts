import { registerAs } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

/**
 * Slice config Postgres, di-register terpisah lewat `registerAs` supaya bisa di-@Inject
 * pakai token (`databaseConfig.KEY`) tanpa menarik seluruh AppConfig.
 */
export default registerAs('database', (): AppConfig['database'] => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  database: process.env.DB_NAME ?? 'rdt',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
}));
