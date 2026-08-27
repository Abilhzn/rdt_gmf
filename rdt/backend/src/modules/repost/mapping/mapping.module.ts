import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { SecurityModule } from '../../../core/security/security.module';
import { MasterDataModule } from '../../master-data/master-data.module';
import { ExclusionService } from './exclusion.service';
import { MappingService } from './mapping.service';
import { RoutingConfigService } from './routing-config.service';

// Tanpa HTTP surface (mapping.controller.ts/exclusions.controller.ts dihapus) — mapping/exclusion
// resolution tetap dipakai RoutingConfigService buat parse upload, tapi editor-nya (dulu diakses
// TAB lewat halaman Admin) dihapus: template input Excel sudah di-fix TAB penanggung jawab repost,
// gak perlu lagi jalur koreksi ad-hoc lewat UI.
@Module({
  imports: [DatabaseModule, SecurityModule, MasterDataModule],
  providers: [MappingService, ExclusionService, RoutingConfigService],
  exports: [RoutingConfigService],
})
export class MappingModule {}
