import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../core/database/database.module';
import { SecurityModule } from '../../core/security/security.module';
import { DinasController } from './dinas.controller';
import { DinasService } from './dinas.service';

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [DinasController],
  providers: [DinasService],
  exports: [DinasService],
})
export class MasterDataModule {}
