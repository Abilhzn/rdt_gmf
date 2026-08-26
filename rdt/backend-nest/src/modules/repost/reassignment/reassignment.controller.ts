import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { BaseController } from '../../../core/base.controller';
import { CurrentUser } from '../../../core/security/current-user.decorator';
import { DinasAccessGuard } from '../../../core/security/dinas-access.guard';
import type { Identity } from '../../../core/security/identity.interface';
import {
  BatchResolveDto,
  ResolveDeclinedDto,
} from './dto/resolve-declined.dto';
import { ReassignmentService } from './reassignment.service';

/**
 * `repost/reassignment` — port `routes/reassignment.js`. GET dipagari `DinasAccessGuard` (3b);
 * POST otorisasinya per-baris (dinas_inisiasi baru diketahui setelah lock, lihat
 * `ReassignmentService.resolveOneDeclined`), bukan lewat guard.
 */
@Controller('repost/reassignment')
export class ReassignmentController extends BaseController {
  constructor(private readonly reassignment: ReassignmentService) {
    super();
  }

  @Get(':dinas')
  @UseGuards(DinasAccessGuard)
  @ApiOperation({
    summary: 'Baris DECLINED milik dinas ini, menunggu resolusi inisiator.',
  })
  async list(@Param('dinas') dinas: string) {
    return this.ok(await this.reassignment.listDeclined(dinas));
  }

  @Post(':id/resolve')
  @ApiOperation({
    summary: 'Resolusi satu baris DECLINED: BORNE_BY_INITIATOR atau REASSIGN.',
  })
  async resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResolveDeclinedDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    await this.reassignment.resolveOne(user, {
      id,
      action: body.action,
      newTarget: body.new_dinas_target,
      rawNote: body.note,
      ip: req.ip ?? null,
    });
    return this.ok({});
  }

  @Post('batch-resolve')
  @ApiOperation({
    summary:
      'Resolusi banyak baris DECLINED sekaligus — satu transaksi, atomik.',
  })
  async batchResolve(
    @Body() body: BatchResolveDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    const result = await this.reassignment.batchResolve(
      user,
      body.items,
      body.note,
      req.ip ?? null,
    );
    return this.ok(result);
  }
}
