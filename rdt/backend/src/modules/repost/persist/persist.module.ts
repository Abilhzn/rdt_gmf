import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { SecurityModule } from '../../../core/security/security.module';
import { StorageModule } from '../../../core/storage/storage.module';
import { SharedModule } from '../shared/shared.module';
import { PersistController } from './persist.controller';
import { PersistService } from './persist.service';

@Module({
  imports: [DatabaseModule, SecurityModule, StorageModule, SharedModule],
  controllers: [PersistController],
  providers: [PersistService],
})
export class PersistModule {}
