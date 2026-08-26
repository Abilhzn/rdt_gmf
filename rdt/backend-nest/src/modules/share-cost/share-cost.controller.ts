import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
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
import { SplitTransactionDto } from './dto/split-transaction.dto';
import { ShareCostService } from './share-cost.service';

/**
 * `share-cost` — port `routes/shareCost.js` (Batch 5.5b, penutup Batch 5.5). TAB-only di SELURUH
 * router (beda dari export/dashboard/period-deadlines yang punya satu endpoint non-TAB) --
 * `@Roles('TAB')` di class-level cukup, tak perlu per-handler.
 */
@Controller('share-cost')
@UseGuards(RolesGuard)
@Roles('TAB')
export class ShareCostController extends BaseController {
  constructor(private readonly shareCost: ShareCostService) {
    super();
  }

  @Get('candidates')
  @ApiOperation({
    summary:
      "Baris PENDING dinas_target='TAB' -- kandidat share-cost split, filter opsional ?q=.",
  })
  async candidates(@Query('q') q?: string) {
    return this.ok({ rows: await this.shareCost.getCandidates(q) });
  }

  @Post(':transactionId/split')
  @ApiOperation({
    summary:
      'Belah satu baris PENDING jadi beberapa baris (dinas_target, nominal) -- atomik, SUM harus persis sama.',
  })
  async split(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Body() body: SplitTransactionDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    return this.ok(
      await this.shareCost.splitTransaction({
        transactionId,
        rawSplits: body.splits,
        rawNote: body.note,
        userId: user.userId,
        ip: req.ip ?? null,
      }),
    );
  }
}
