import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { DirectoryModule } from '../../core/directory/directory.module';
import { SecurityModule } from '../../core/security/security.module';
import { SharedModule } from '../repost/shared/shared.module';
import { DashboardDetailService } from './dashboard-detail.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [DatabaseModule, SecurityModule, SharedModule, DirectoryModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardDetailService],
})
export class DashboardModule {}
