import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { BaseController } from '../../../core/base.controller';
import { CurrentUser } from '../../../core/security/current-user.decorator';
import type { Identity } from '../../../core/security/identity.interface';
import { Roles } from '../../../core/security/roles.decorator';
import { RolesGuard } from '../../../core/security/roles.guard';
import { ReplaceExclusionsDto } from './dto/replace-exclusions.dto';
import { ExclusionService } from './exclusion.service';

/**
 * `GET/PUT /repost/exclusions` — TAB-only (port `index.js` `/api/exclusions`). PUT = replace-all
 * (beda dari mapping's merge — lihat `ExclusionService.replaceAll`).
 */
@Controller('repost/exclusions')
@UseGuards(RolesGuard)
@Roles('TAB')
export class ExclusionsController extends BaseController {
  constructor(private readonly exclusions: ExclusionService) {
    super();
  }

  @Get()
  @ApiOperation({
    summary:
      'Baca exclusion_rules (prefix yang dikecualikan dari repost lintas dinas).',
  })
  async getAll() {
    return this.ok({ prefixes: await this.exclusions.getAll() });
  }

  @Put()
  @ApiOperation({
    summary: 'Replace-all exclusion_rules — { "prefixes": [...] }.',
  })
  async replaceAll(
    @Body() dto: ReplaceExclusionsDto,
    @CurrentUser() user: Identity,
  ) {
    await this.exclusions.replaceAll(dto.prefixes, user.userId);
    return this.ok({ prefixes: dto.prefixes });
  }
}
