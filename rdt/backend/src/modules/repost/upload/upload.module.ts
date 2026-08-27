import { Module } from '@nestjs/common';
import { StorageModule } from '../../../core/storage/storage.module';
import { MappingModule } from '../mapping/mapping.module';
import { ExcelParserService } from './parser/excel-parser.service';
import { UploadController } from './upload.controller';

@Module({
  imports: [StorageModule, MappingModule],
  controllers: [UploadController],
  providers: [ExcelParserService],
  exports: [ExcelParserService],
})
export class UploadModule {}
