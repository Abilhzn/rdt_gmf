import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { SecurityModule } from '../../../core/security/security.module';
import { MasterDataModule } from '../../master-data/master-data.module';
import { ExclusionsController } from './exclusions.controller';
import { ExclusionService } from './exclusion.service';
import { MappingController } from './mapping.controller';
import { MappingService } from './mapping.service';
import { RoutingConfigService } from './routing-config.service';

@Module({
  imports: [DatabaseModule, SecurityModule, MasterDataModule],
  controllers: [MappingController, ExclusionsController],
  providers: [MappingService, ExclusionService, RoutingConfigService],
  exports: [RoutingConfigService],
})
export class MappingModule {}
