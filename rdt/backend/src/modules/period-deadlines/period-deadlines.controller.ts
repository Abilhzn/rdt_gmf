import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { BaseController } from '../../core/base.controller';
import { CurrentUser } from '../../core/security/current-user.decorator';
import type { Identity } from '../../core/security/identity.interface';
import { Roles } from '../../core/security/roles.decorator';
import { RolesGuard } from '../../core/security/roles.guard';
import { UpsertDefaultDeadlineDto } from './dto/upsert-default-deadline.dto';
import { UpsertPeriodDeadlineDto } from './dto/upsert-period-deadline.dto';
import { PeriodDeadlinesService } from './period-deadlines.service';

/**
 * `period-deadlines` — port `routes/periodDeadlines.js` (Batch 5.5a). TAB-only di semua endpoint
 * KECUALI `GET current-reminder` (semua user login -- reminder banner tampil di halaman repost
 * dinas mana pun), jadi `@Roles('TAB')` dipasang per-handler (bukan class-level), sama pola
 * `ExportController`/`DashboardController`.
 */
@ApiTags('period-deadlines')
@Controller('period-deadlines')
@UseGuards(RolesGuard)
export class PeriodDeadlinesController extends BaseController {
  constructor(private readonly periodDeadlines: PeriodDeadlinesService) {
    super();
  }

  @Get('current-reminder')
  @ApiOperation({
    summary:
      'Deadline default periode berjalan -- reminder banner, semua user login.',
  })
  async currentReminder() {
    return this.ok(await this.periodDeadlines.getCurrentReminder());
  }

  @Get()
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Daftar deadline per-pasangan, filter opsional dinas_inisiasi/dinas_target.',
  })
  async list(
    @Query('dinas_inisiasi') dinasInisiasi?: string,
    @Query('dinas_target') dinasTarget?: string,
  ) {
    return this.ok({
      deadlines: await this.periodDeadlines.listDeadlines(
        dinasInisiasi,
        dinasTarget,
      ),
    });
  }

  @Post()
  @Roles('TAB')
  @ApiOperation({
    summary: 'Set/update deadline satu pasangan × periode (upsert).',
  })
  async upsert(
    @Body() body: UpsertPeriodDeadlineDto,
    @CurrentUser() user: Identity,
  ) {
    const deadline = await this.periodDeadlines.upsertDeadline({
      rawDinasInisiasi: body.dinas_inisiasi,
      rawDinasTarget: body.dinas_target,
      rawPeriode: body.periode,
      rawDeadlineAt: body.deadline_at,
      userId: user.userId,
    });
    return this.ok({ deadline });
  }

  @Get('default')
  @Roles('TAB')
  @ApiOperation({
    summary: 'Semua deadline default periode-wide yang pernah diset.',
  })
  async listDefaults() {
    return this.ok({ deadlines: await this.periodDeadlines.listDefaults() });
  }

  @Post('default')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Set deadline default satu periode + sweep ke pasangan yang sudah punya transaksi non-terminal di periode itu (atomik).',
  })
  async upsertDefault(
    @Body() body: UpsertDefaultDeadlineDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    return this.ok(
      await this.periodDeadlines.upsertDefault({
        rawPeriode: body.periode,
        rawDeadlineAt: body.deadline_at,
        userId: user.userId,
        ip: req.ip ?? null,
      }),
    );
  }

  @Delete('default/:periode')
  @Roles('TAB')
  @ApiOperation({
    summary: 'Hapus deadline default -- hanya kalau masih di masa depan.',
  })
  async deleteDefault(@Param('periode') periode: string) {
    return this.ok(await this.periodDeadlines.deleteDefault(periode));
  }

  @Get('overdue')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Pasangan 100% resolved tapi periode_efektif sudah bergeser dari periode ini -- informational.',
  })
  async overdue(@Query('periode') periode?: string) {
    return this.ok(await this.periodDeadlines.getOverdue(periode));
  }

  @Get('active-pairs')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Pasangan yang masih punya baris PENDING/DECLINED/NEEDS_REVIEW di periode ini.',
  })
  async activePairs(@Query('periode') periode?: string) {
    return this.ok(await this.periodDeadlines.getActivePairs(periode));
  }
}
