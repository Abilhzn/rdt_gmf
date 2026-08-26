import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { BaseController } from '../../../core/base.controller';
import { DomainError } from '../../../core/errors/domain-error';
import { CurrentUser } from '../../../core/security/current-user.decorator';
import type { Identity } from '../../../core/security/identity.interface';
import { Roles } from '../../../core/security/roles.decorator';
import { RolesGuard } from '../../../core/security/roles.guard';
import { MappingService } from './mapping.service';

/**
 * `GET/PUT /repost/mapping` — TAB-only (port `index.js` `/api/mapping`). PUT = merge/upsert,
 * key yang tak disebut TIDAK dihapus.
 */
@Controller('repost/mapping')
@UseGuards(RolesGuard)
@Roles('TAB')
export class MappingController extends BaseController {
  constructor(private readonly mapping: MappingService) {
    super();
  }

  @Get()
  @ApiOperation({
    summary: 'Baca dinas_mapping (Recipient prefix -> dinas_code).',
  })
  async getAll() {
    return this.ok(await this.mapping.getAll());
  }

  @Put()
  @ApiOperation({
    summary:
      'Upsert/merge dinas_mapping — { "<prefix>": "<dinas_code>", ... }.',
  })
  async upsert(
    @Body() body: Record<string, string>,
    @CurrentUser() user: Identity,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new DomainError(
        'Body mapping harus { "<prefix>": "<dinas_code>", ... }',
        400,
        'INVALID_MAPPING_BODY',
      );
    }
    await this.mapping.upsertMany(body, user.userId);
    return this.ok({ updated: Object.keys(body).length });
  }
}
