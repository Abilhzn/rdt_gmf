import { plainToInstance } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsOptional,
  validateSync,
} from 'class-validator';

/**
 * Fail-fast boot check: dipanggil lewat `ConfigModule.forRoot({ validate })`. Kalau ada yang
 * gagal di sini, Nest melempar exception SEBELUM app listen — bukan silent fallback ke default
 * seperti sebelumnya (lihat RENCANA_REWRITE_NESTJS.md §8 Batch 7).
 *
 * DB_* wajib ada (boleh string kosong secara eksplisit, tapi tidak boleh undefined). Mode enum
 * (IDENTITY_MODE dkk) boleh tidak diisi (fallback ke default di configuration.ts), tapi kalau
 * diisi harus salah satu nilai valid — typo yang lolos lebih berbahaya daripada kosong.
 */
class EnvVars {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsNotEmpty({ message: 'DB_HOST wajib diisi di .env' })
  DB_HOST!: string;

  @IsNotEmpty({ message: 'DB_PORT wajib diisi di .env' })
  DB_PORT!: string;

  @IsNotEmpty({ message: 'DB_NAME wajib diisi di .env' })
  DB_NAME!: string;

  @IsNotEmpty({ message: 'DB_USER wajib diisi di .env' })
  DB_USER!: string;

  // Boleh string kosong (setup tanpa password), tapi harus didefinisikan secara eksplisit.
  @IsDefined({
    message: 'DB_PASSWORD wajib didefinisikan di .env (boleh kosong)',
  })
  DB_PASSWORD!: string;

  @IsOptional()
  @IsIn(['dev-mock', 'ocx'], {
    message: 'IDENTITY_MODE harus "dev-mock" atau "ocx" (typo terdeteksi)',
  })
  IDENTITY_MODE?: string;

  @IsOptional()
  @IsIn(['seed', 'ocx'], {
    message: 'DIRECTORY_MODE harus "seed" atau "ocx" (typo terdeteksi)',
  })
  DIRECTORY_MODE?: string;

  @IsOptional()
  @IsIn(['filesystem', 'minio'], {
    message: 'STORAGE_DRIVER harus "filesystem" atau "minio" (typo terdeteksi)',
  })
  STORAGE_DRIVER?: string;
}

export function validate(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join('; '))
      .join('\n  - ');
    throw new Error(`Konfigurasi environment tidak valid:\n  - ${messages}`);
  }

  // Guardrail keamanan paling penting: dev-mock TIDAK memvalidasi header x-dev-* apa pun, jadi
  // siapa saja bisa impersonate user/role manapun. Tidak boleh lolos ke production diam-diam.
  const nodeEnv = validated.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && validated.IDENTITY_MODE !== 'ocx') {
    throw new Error(
      'Konfigurasi environment tidak valid:\n' +
        '  - IDENTITY_MODE harus "ocx" saat NODE_ENV=production (dev-mock/kosong tidak divalidasi ' +
        'sama sekali, siapa pun bisa impersonate user/role lewat header x-dev-*)',
    );
  }

  return validated;
}
