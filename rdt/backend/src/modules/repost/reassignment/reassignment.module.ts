import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { SecurityModule } from '../../../core/security/security.module';
import { SharedModule } from '../shared/shared.module';
import { ReassignmentController } from './reassignment.controller';
import { ReassignmentService } from './reassignment.service';

@Module({
  imports: [DatabaseModule, SecurityModule, SharedModule],
  controllers: [ReassignmentController],
  providers: [ReassignmentService],
})
export class ReassignmentModule {}
