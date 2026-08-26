import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { DirectoryModule } from '../../../core/directory/directory.module';
import { SecurityModule } from '../../../core/security/security.module';
import { SharedModule } from '../shared/shared.module';
import { ExportConfirmService } from './export-confirm.service';
import { ExportController } from './export.controller';
import { ExportHistoryService } from './export-history.service';
import { ExportService } from './export.service';
import { ExportSubdocService } from './export-subdoc.service';
import { FormatTabExportService } from './format-tab-export.service';

@Module({
  imports: [DatabaseModule, SecurityModule, SharedModule, DirectoryModule],
  controllers: [ExportController],
  providers: [
    ExportService,
    FormatTabExportService,
    ExportConfirmService,
    ExportSubdocService,
    ExportHistoryService,
  ],
})
export class ExportModule {}
