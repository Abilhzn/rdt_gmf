import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { DevMockIdentityProvider } from './dev-mock-identity.provider';
import { DinasAccessGuard } from './dinas-access.guard';
import { IDENTITY_PROVIDER } from './identity.interface';
import { IdentityMiddleware } from './identity.middleware';
import { OcxIdentityProvider } from './ocx-identity.provider';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [ConfigModule],
  providers: [
    DevMockIdentityProvider,
    OcxIdentityProvider,
    IdentityMiddleware,
    DinasAccessGuard,
    RolesGuard,
    {
      provide: IDENTITY_PROVIDER,
      useFactory: (
        config: ConfigService<AppConfig>,
        devMock: DevMockIdentityProvider,
        ocx: OcxIdentityProvider,
      ) =>
        config.get('identity.mode', { infer: true }) === 'ocx' ? ocx : devMock,
      inject: [ConfigService, DevMockIdentityProvider, OcxIdentityProvider],
    },
  ],
  exports: [
    IdentityMiddleware,
    DinasAccessGuard,
    RolesGuard,
    IDENTITY_PROVIDER,
  ],
})
export class SecurityModule {}
