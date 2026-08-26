import * as fs from 'fs';
import * as path from 'path';

/**
 * Seed lokal (file JSON) untuk resolusi Recipient → dinas_target. Batch 1: satu-satunya sumber.
 * Batch 2: dipindah ke DB (TAB Admin UI); signature `ExcelParserService` sudah menerima override
 * lewat `ParseOptions` (mapping/exclusions/dinasCodes) persis untuk titik ganti itu — file ini
 * hanya jadi default kalau caller tidak mengirim override.
 */
export interface DinasMappingSeed {
  [prefix: string]: string;
}
export interface ExclusionRulesSeed {
  prefixes: string[];
}
export interface DinasCodesSeed {
  codes: string[];
}

function loadJson<T>(filename: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, filename), 'utf8'),
  ) as T;
}

export function loadMappingSeed(): DinasMappingSeed {
  return loadJson<DinasMappingSeed>('mapping.seed.json');
}

export function loadExclusionsSeed(): ExclusionRulesSeed {
  return loadJson<ExclusionRulesSeed>('exclusions.config.json');
}

export function loadDinasCodesSeed(): DinasCodesSeed {
  return loadJson<DinasCodesSeed>('dinas.codes.json');
}
