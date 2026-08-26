import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { SecurityModule } from '../../../core/security/security.module';
import { SharedModule } from '../shared/shared.module';
import { InvestigationController } from './investigation.controller';
import { InvestigationService } from './investigation.service';

@Module({
  imports: [DatabaseModule, SecurityModule, SharedModule],
  controllers: [InvestigationController],
  providers: [InvestigationService],
})
export class InvestigationModule {}
