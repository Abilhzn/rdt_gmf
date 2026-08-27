import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BaseController } from '../core/base.controller';
import { DatabaseService } from '../core/database/database.service';

@ApiTags('health')
@Controller('health')
export class HealthController extends BaseController {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  @Get()
  @ApiOkResponse({
    description: 'App up, plus best-effort DB connectivity check.',
  })
  async check() {
    let dbConnected = true;
    try {
      await this.db.query('SELECT 1');
    } catch {
      dbConnected = false;
    }
    return { status: 'ok', db: dbConnected ? 'ok' : 'unreachable' };
  }
}
