import { Injectable } from '@nestjs/common';
import { DinasService } from '../../master-data/dinas.service';
import { ExclusionService } from './exclusion.service';
import { MappingService } from './mapping.service';

export interface RoutingConfig {
  mapping: Record<string, string>;
  exclusions: { prefixes: string[] };
  dinasCodes: string[];
}

/**
 * Sumber config parser dari DB — pengganti seed-JSON loader Batch 1 di jalur controller
 * (`upload.controller.ts`). Parser sendiri tetap menerima ini sebagai param opsional dan
 * fallback ke seed JSON kalau tak diberi (lihat `ExcelParserService.resolveSeeds`) — jadi
 * test parser Batch 1 (yang tak mengoper config) tetap hijau.
 */
@Injectable()
export class RoutingConfigService {
  constructor(
    private readonly mapping: MappingService,
    private readonly exclusions: ExclusionService,
    private readonly dinas: DinasService,
  ) {}

  async assemble(): Promise<RoutingConfig> {
    const [mapping, prefixes, dinasCodes] = await Promise.all([
      this.mapping.getAll(),
      this.exclusions.getAll(),
      this.dinas.listAllCodes(),
    ]);
    return { mapping, exclusions: { prefixes }, dinasCodes };
  }
}
