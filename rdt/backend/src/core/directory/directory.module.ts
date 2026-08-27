import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { DIRECTORY_PROVIDER } from './directory.interface';
import { OcxDirectoryProvider } from './ocx-directory.provider';
import { SeedDirectoryProvider } from './seed-directory.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    SeedDirectoryProvider,
    OcxDirectoryProvider,
    {
      provide: DIRECTORY_PROVIDER,
      useFactory: (
        config: ConfigService<AppConfig>,
        seed: SeedDirectoryProvider,
        ocx: OcxDirectoryProvider,
      ) =>
        config.get('directory.mode', { infer: true }) === 'ocx' ? ocx : seed,
      inject: [ConfigService, SeedDirectoryProvider, OcxDirectoryProvider],
    },
  ],
  exports: [DIRECTORY_PROVIDER],
})
export class DirectoryModule {}
