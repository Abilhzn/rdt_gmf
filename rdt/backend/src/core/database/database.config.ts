import { registerAs } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

/**
 * Slice config Postgres, di-register terpisah lewat `registerAs` supaya bisa di-@Inject
 * pakai token (`databaseConfig.KEY`) tanpa menarik seluruh AppConfig.
 */
// DB_* dijamin ada oleh env.validation.ts (ConfigModule.forRoot({ validate })) -- tidak diam-diam
// fallback ke default di sini.
export default registerAs('database', (): AppConfig['database'] => ({
  host: process.env.DB_HOST as string,
  port: parseInt(process.env.DB_PORT as string, 10),
  database: process.env.DB_NAME as string,
  user: process.env.DB_USER as string,
  password: process.env.DB_PASSWORD as string,
}));
