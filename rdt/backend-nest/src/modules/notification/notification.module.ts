import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { DirectoryModule } from '../../core/directory/directory.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [DatabaseModule, DirectoryModule],
  controllers: [NotificationController],
  providers: [NotificationService],
})
export class NotificationModule {}
