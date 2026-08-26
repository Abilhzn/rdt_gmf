import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { SecurityModule } from '../../core/security/security.module';
import { SharedModule } from '../repost/shared/shared.module';
import { ShareCostController } from './share-cost.controller';
import { ShareCostService } from './share-cost.service';

@Module({
  imports: [DatabaseModule, SecurityModule, SharedModule],
  controllers: [ShareCostController],
  providers: [ShareCostService],
})
export class ShareCostModule {}
