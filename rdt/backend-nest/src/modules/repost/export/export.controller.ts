import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { BaseController } from '../../../core/base.controller';
import { CurrentUser } from '../../../core/security/current-user.decorator';
import type { Identity } from '../../../core/security/identity.interface';
import { Roles } from '../../../core/security/roles.decorator';
import { RolesGuard } from '../../../core/security/roles.guard';
import { AddSubdocDto } from './dto/add-subdoc.dto';
import { ConfirmExportDto } from './dto/confirm-export.dto';
import { ExportConfirmService } from './export-confirm.service';
import { ExportHistoryService } from './export-history.service';
import { ExportService } from './export.service';
import { ExportSubdocService } from './export-subdoc.service';

/**
 * `repost/export` — port `routes/exportBatches.js`. TAB-only di semua endpoint KECUALI
 * `GET history` (Batch 4c) — dia force-scoped ke dinas pengaju sendiri kalau bukan TAB, bukan
 * ditutup total, jadi `@Roles('TAB')` sengaja dipasang PER-HANDLER (bukan di class) supaya
 * `history` bisa dilewati tanpa role apa pun (`RolesGuard` lolos tanpa metadata `@Roles`).
 *
 * ⚠️ Format TAB 8-kolom SAJA -- format 53-kolom "contract" lama DIBUANG total (lihat
 * `FormatTabExportService`).
 */
@Controller('repost/export')
@UseGuards(RolesGuard)
export class ExportController extends BaseController {
  constructor(
    private readonly exportService: ExportService,
    private readonly exportConfirm: ExportConfirmService,
    private readonly exportSubdoc: ExportSubdocService,
    private readonly exportHistory: ExportHistoryService,
  ) {
    super();
  }

  @Post('confirm')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Confirm satu pasangan siap-repost — atomik: batch + subdoc pertama + comment/notif.',
  })
  async confirm(
    @Body() body: ConfirmExportDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    const result = await this.exportConfirm.confirm({
      rawDinasInisiasi: body.dinas_inisiasi,
      rawDinasTarget: body.dinas_target,
      rawClosingDescription: body.closing_description,
      rawSubdocNumber: body.subdoc_number,
      rawTransactionIds: body.transaction_ids,
      userId: user.userId,
      ip: req.ip ?? null,
    });
    return this.ok(result);
  }

  @Get('waiting')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Pasangan (dinas_inisiasi, dinas_target) yang siap di-repost (nol baris BLOCKING).',
  })
  async waiting() {
    return this.ok(await this.exportService.getWaiting());
  }

  @Get('history')
  @ApiOperation({
    summary:
      'Riwayat repost — TAB lihat semua, dinas pengaju lain hanya lihat miliknya sendiri (force-scoped, tak ada bypass).',
  })
  async history(
    @CurrentUser() user: Identity,
    @Query('periode') periode?: string,
  ) {
    return this.ok(await this.exportHistory.getHistory(user, periode));
  }

  @Post(':batchId/subdocs')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Subdoc tambahan (overflow >300 baris) ke batch yang sudah ada -- transaksi tersendiri dari confirm.',
  })
  async addSubdoc(
    @Param('batchId', ParseIntPipe) batchId: number,
    @Body() body: AddSubdocDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    const result = await this.exportSubdoc.addSubdoc({
      batchId,
      rawSubdocNumber: body.subdoc_number,
      rawTransactionIds: body.transaction_ids,
      userId: user.userId,
      ip: req.ip ?? null,
    });
    return this.ok({ subdoc: result });
  }

  @Get(':batchId/lines')
  @Roles('TAB')
  @ApiOperation({ summary: 'Baris transaksi satu batch, ditandai subdoc-nya.' })
  async lines(@Param('batchId', ParseIntPipe) batchId: number) {
    return this.ok(await this.exportService.getBatchLines(batchId));
  }

  @Get('transparency/:dinasInisiasi/:dinasTarget')
  @Roles('TAB')
  @ApiOperation({
    summary: 'Detail penuh baris currently-unbatched satu pasangan.',
  })
  async transparency(
    @Param('dinasInisiasi') dinasInisiasi: string,
    @Param('dinasTarget') dinasTarget: string,
  ) {
    return this.ok(
      await this.exportService.getTransparency(dinasInisiasi, dinasTarget),
    );
  }

  @Get('export/:batchId')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Download Format TAB (8 kolom) CONFIRMED-only untuk satu batch yang sudah ada.',
  })
  async exportBatch(
    @Param('batchId', ParseIntPipe) batchId: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const payload = await this.exportService.exportBatch(batchId);
    return this.streamPayload(res, payload);
  }

  @Get('export-pair/:dinasInisiasi/:dinasTarget')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Download Format TAB langsung dari pasangan (tanpa batch) -- pure read, tersedia sebelum confirm.',
  })
  async exportPair(
    @Param('dinasInisiasi') dinasInisiasi: string,
    @Param('dinasTarget') dinasTarget: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const payload = await this.exportService.exportPair(
      dinasInisiasi,
      dinasTarget,
    );
    return this.streamPayload(res, payload);
  }

  private streamPayload(
    res: Response,
    payload: { filename: string; contentType: string; buffer: Buffer },
  ): StreamableFile {
    res.set({
      'Content-Type': payload.contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(payload.filename)}"`,
    });
    return new StreamableFile(payload.buffer);
  }
}
