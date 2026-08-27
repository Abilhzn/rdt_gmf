import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BaseController } from '../../core/base.controller';
import { DinasAccessGuard } from '../../core/security/dinas-access.guard';
import { DinasService } from './dinas.service';

/** `GET /dinas` — semua user login (bukan TAB-only), untuk picker/reassign target. */
@ApiTags('master-data')
@Controller('dinas')
@UseGuards(DinasAccessGuard)
export class DinasController extends BaseController {
  constructor(private readonly dinas: DinasService) {
    super();
  }

  @Get()
  @ApiOperation({ summary: 'Daftar dinas aktif (untuk picker/reassign).' })
  async listActive() {
    return this.ok(await this.dinas.listActive());
  }
}
