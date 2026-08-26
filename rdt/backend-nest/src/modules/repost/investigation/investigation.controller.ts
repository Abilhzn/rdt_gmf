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
import type { Identity } from '../../../core/security/identity.interface';
import { Roles } from '../../../core/security/roles.decorator';
import { RolesGuard } from '../../../core/security/roles.guard';
import {
  AssignAllDto,
  AssignInvestigationDto,
} from './dto/assign-investigation.dto';
import { InvestigationService } from './investigation.service';

/**
 * `repost/investigation` — port `routes/investigation.js`. TAB-only di semua endpoint (baris
 * `NEEDS_INVESTIGATION` = Recipient literal "Ask TA", cuma TAB yang boleh tugaskan dinas_target-nya).
 */
@Controller('repost/investigation')
@UseGuards(RolesGuard)
@Roles('TAB')
export class InvestigationController extends BaseController {
  constructor(private readonly investigation: InvestigationService) {
    super();
  }

  @Get()
  @ApiOperation({ summary: 'Semua baris NEEDS_INVESTIGATION, tertua dulu.' })
  async list() {
    return this.ok(await this.investigation.listPending());
  }

  @Post(':transactionId/assign')
  @ApiOperation({
    summary: 'Tugaskan dinas_target — langsung CONFIRMED + ledger, final.',
  })
  async assign(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Body() body: AssignInvestigationDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    const result = await this.investigation.assignOne(user, {
      transactionId,
      newTarget: body.dinas_target,
      rawDescription: body.description,
      ip: req.ip ?? null,
    });
    return this.ok(result);
  }

  @Post('assign-all')
  @ApiOperation({
    summary:
      'Tugaskan banyak baris sekaligus — satu transaksi, all-or-nothing.',
  })
  async assignAll(
    @Body() body: AssignAllDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    const result = await this.investigation.assignAll(
      user,
      body.items,
      body.description,
      req.ip ?? null,
    );
    return this.ok(result);
  }
}
