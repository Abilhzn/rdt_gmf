import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { BaseController } from '../../../core/base.controller';
import { CurrentUser } from '../../../core/security/current-user.decorator';
import { DinasAccessGuard } from '../../../core/security/dinas-access.guard';
import type { Identity } from '../../../core/security/identity.interface';
import { ConfirmationService } from './confirmation.service';
import { SubmitConfirmationDto } from './dto/submit-confirmation.dto';

/**
 * `GET/POST repost/confirmation/:dinas(/submit)` — port `routes/confirmation.js`. Hanya PIC
 * dinas target sendiri atau role TAB yang boleh akses (DinasAccessGuard, Batch 3b).
 */
@ApiTags('repost-confirmation')
@Controller('repost/confirmation')
@UseGuards(DinasAccessGuard)
export class ConfirmationController extends BaseController {
  constructor(private readonly confirmation: ConfirmationService) {
    super();
  }

  @Get(':dinas')
  @ApiOperation({
    summary: 'Antrian PENDING milik dinas ini (+ breadcrumb reassign chain).',
  })
  async getQueue(@Param('dinas') dinas: string) {
    return this.ok(await this.confirmation.getQueue(dinas));
  }

  @Post(':dinas/submit')
  @ApiOperation({
    summary:
      'Batch CONFIRM/DECLINE/REJECT_REDIRECT — atomik, guardrail transaksi finansial.',
  })
  async submit(
    @Param('dinas') dinas: string,
    @Body() body: SubmitConfirmationDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    const result = await this.confirmation.submit(
      dinas,
      user.userId,
      body.decisions,
      body.description,
      req.ip ?? null,
    );
    return this.ok(result);
  }
}
