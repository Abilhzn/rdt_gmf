import {
  Body,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { BaseController } from '../../../core/base.controller';
import { DomainError } from '../../../core/errors/domain-error';
import { DetailRow } from '../../../core/interfaces/detail-row.interface';
import { RowStatus } from '../../../core/enums/row-status.enum';
import { STORAGE_SERVICE } from '../../../core/storage/storage.service';
import type { StorageService } from '../../../core/storage/storage.service';
import { RoutingConfigService } from '../mapping/routing-config.service';
import { ParseUploadDto } from './dto/parse-upload.dto';
import { ExcelParserService } from './parser/excel-parser.service';

interface RecapEntry {
  dinasTarget: string | null;
  status: RowStatus;
  count: number;
  totalNominal: number;
}

/**
 * Preview-only (Batch 1) — upload file → simpan (StorageService, driver filesystem di dev) →
 * parse → balikin rows + rekap. `persist` ke DB DITUNDA (butuh transaksi, masuk batch setelah
 * confirmation — lihat RENCANA_REWRITE_NESTJS.md).
 */
@Controller('repost/upload')
export class UploadController extends BaseController {
  constructor(
    private readonly parser: ExcelParserService,
    private readonly routingConfig: RoutingConfigService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {
    super();
  }

  @Post('parse')
  @ApiOperation({
    summary: 'Upload Excel Format CBO, simpan, dan preview hasil parse.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async parse(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ParseUploadDto,
  ) {
    if (!file) {
      throw new DomainError(
        'File wajib diunggah (field "file")',
        400,
        'FILE_REQUIRED',
      );
    }

    const objectName = `uploads/${Date.now()}-${file.originalname}`;
    await this.storage.putObject(objectName, file.buffer, file.mimetype);

    // Config dari DB (dinas_mapping/exclusion_rules/dinas) — pengganti seed JSON di jalur HTTP.
    // Parser sendiri masih fallback ke seed kalau dipanggil tanpa ini (lihat parseBuffer di test).
    const routingConfig = await this.routingConfig.assemble();
    const rows = await this.parser.parseBuffer(file.buffer, {
      uploaderDinas: dto.uploaderDinas,
      ...routingConfig,
    });
    return this.ok({
      objectName,
      rowCount: rows.length,
      rows,
      recap: this.buildRecap(rows),
    });
  }

  private buildRecap(rows: DetailRow[]): RecapEntry[] {
    const byKey = new Map<string, RecapEntry>();
    for (const row of rows) {
      const key = `${row.status_konfirmasi}|${row.dinas_target ?? ''}`;
      const entry = byKey.get(key) ?? {
        dinasTarget: row.dinas_target,
        status: row.status_konfirmasi,
        count: 0,
        totalNominal: 0,
      };
      entry.count += 1;
      entry.totalNominal =
        Math.round((entry.totalNominal + (row.nominal ?? 0)) * 100) / 100;
      byKey.set(key, entry);
    }
    return [...byKey.values()];
  }
}
