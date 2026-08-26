import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { SecurityModule } from '../../core/security/security.module';
import { SharedModule } from '../repost/shared/shared.module';
import { PeriodDeadlinesController } from './period-deadlines.controller';
import { PeriodDeadlinesService } from './period-deadlines.service';

@Module({
  imports: [DatabaseModule, SecurityModule, SharedModule],
  controllers: [PeriodDeadlinesController],
  providers: [PeriodDeadlinesService],
})
export class PeriodDeadlinesModule {}
