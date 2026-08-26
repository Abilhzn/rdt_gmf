import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { BaseController } from '../../core/base.controller';
import { CurrentUser } from '../../core/security/current-user.decorator';
import type { Identity } from '../../core/security/identity.interface';
import { Roles } from '../../core/security/roles.decorator';
import { RolesGuard } from '../../core/security/roles.guard';
import { DashboardDetailService } from './dashboard-detail.service';
import { PostPairCommentDto } from './dto/post-pair-comment.dto';
import { DashboardService } from './dashboard.service';

/**
 * `dashboard` — port `routes/dashboard.js`, bagian BACA-SAJA (Batch 5b). Guard identity biasa
 * (semua user login) kecuali `per-dinas-rollup` & `summary/:dinasInisiasi/breakdown` yang
 * TAB-only (`@Roles('TAB')` per-handler, sama pola dengan `ExportController` 4c).
 */
@Controller('dashboard')
@UseGuards(RolesGuard)
export class DashboardController extends BaseController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly dashboardDetail: DashboardDetailService,
  ) {
    super();
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'as_initiator (chain-aware, per-dinas kalau non-TAB / global kalau TAB) + need_to_confirm.',
  })
  async summary(@CurrentUser() user: Identity) {
    return this.ok(await this.dashboard.getSummary(user));
  }

  @Get('need-to-confirm-count')
  @ApiOperation({
    summary: 'Badge sidebar -- hitungan murah, bukan kartu penuh.',
  })
  async needToConfirmCount(@CurrentUser() user: Identity) {
    return this.ok({ count: await this.dashboard.getNeedToConfirmCount(user) });
  }

  @Get('kpis')
  @ApiOperation({
    summary: 'KPI cards -- shape beda total per role (non-TAB vs TAB).',
  })
  async kpis(@CurrentUser() user: Identity) {
    return this.ok(await this.dashboard.getKpis(user));
  }

  @Get('per-dinas-rollup')
  @Roles('TAB')
  @ApiOperation({
    summary:
      'Semua pasangan satu dinas_inisiasi dijumlah jadi satu baris + status pill.',
  })
  async perDinasRollup() {
    return this.ok(await this.dashboard.getPerDinasRollup());
  }

  @Get('summary/:dinasInisiasi/breakdown')
  @Roles('TAB')
  @ApiOperation({
    summary: 'Pecahan per-pasangan di balik satu baris per-dinas-rollup.',
  })
  async breakdown(@Param('dinasInisiasi') dinasInisiasi: string) {
    const pairs = await this.dashboard.getBreakdown(dinasInisiasi);
    return this.ok({ dinas_inisiasi: dinasInisiasi, pairs });
  }

  // --- Dashboard-Detailing + comment thread (Batch 5c) --- akses via `canAccessPair` di dalam
  // service (PIC salah satu sisi pasangan, atau TAB), BUKAN `@Roles()` -- tergantung parameter
  // path `:initiatorDinas/:targetDinas`, tak bisa diputuskan lewat metadata role statis.

  @Get('detail/:initiatorDinas/:targetDinas')
  @ApiOperation({
    summary:
      'Drill-down satu pasangan (progress dihitung langsung dari transaksinya, bukan kartu 5b) + comment thread.',
  })
  async detail(
    @Param('initiatorDinas') initiatorDinas: string,
    @Param('targetDinas') targetDinas: string,
    @CurrentUser() user: Identity,
  ) {
    return this.ok(
      await this.dashboardDetail.getDetail(user, initiatorDinas, targetDinas),
    );
  }

  @Get('detail/:initiatorDinas/:targetDinas/comments')
  @ApiOperation({
    summary: 'Versi ringan detail -- comment thread saja, buat polling.',
  })
  async pairComments(
    @Param('initiatorDinas') initiatorDinas: string,
    @Param('targetDinas') targetDinas: string,
    @CurrentUser() user: Identity,
  ) {
    return this.ok(
      await this.dashboardDetail.getComments(user, initiatorDinas, targetDinas),
    );
  }

  @Post('detail/:initiatorDinas/:targetDinas/comments')
  @ApiOperation({
    summary:
      'Posting comment ke pasangan ini -- reply kalau parent_comment_id diberi, else top-level baru.',
  })
  async postPairComment(
    @Param('initiatorDinas') initiatorDinas: string,
    @Param('targetDinas') targetDinas: string,
    @Body() body: PostPairCommentDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    return this.ok(
      await this.dashboardDetail.postComment({
        user,
        initiatorDinas,
        targetDinas,
        rawBody: body.body,
        rawParentCommentId: body.parent_comment_id,
        ip: req.ip ?? null,
      }),
    );
  }
}
