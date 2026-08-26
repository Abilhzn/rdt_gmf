import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { SecurityModule } from '../../../core/security/security.module';
import { SharedModule } from '../shared/shared.module';
import { ConfirmationController } from './confirmation.controller';
import { ConfirmationService } from './confirmation.service';

@Module({
  imports: [DatabaseModule, SecurityModule, SharedModule],
  controllers: [ConfirmationController],
  providers: [ConfirmationService],
})
export class ConfirmationModule {}
