import { Module } from '@nestjs/common';
import { ConfirmationModule } from './confirmation/confirmation.module';
import { ExportModule } from './export/export.module';
import { InvestigationModule } from './investigation/investigation.module';
import { MappingModule } from './mapping/mapping.module';
import { PersistModule } from './persist/persist.module';
import { ReassignmentModule } from './reassignment/reassignment.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    UploadModule,
    MappingModule,
    ConfirmationModule,
    ReassignmentModule,
    InvestigationModule,
    PersistModule,
    ExportModule,
  ],
})
export class RepostModule {}
