import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { DatabaseModule } from './core/database/database.module';
import { IdentityMiddleware } from './core/security/identity.middleware';
import { SecurityModule } from './core/security/security.module';
import { StorageModule } from './core/storage/storage.module';
import { HealthModule } from './health/health.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PeriodDeadlinesModule } from './modules/period-deadlines/period-deadlines.module';
import { RepostModule } from './modules/repost/repost.module';
import { ShareCostModule } from './modules/share-cost/share-cost.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    DatabaseModule,
    StorageModule,
    SecurityModule,
    HealthModule,
    RepostModule,
    NotificationModule,
    DashboardModule,
    PeriodDeadlinesModule,
    ShareCostModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IdentityMiddleware).forRoutes('*');
  }
}
