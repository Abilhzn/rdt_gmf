import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Semua field longgar (@IsOptional string) dengan sengaja — validasi "wajib"/"JSON valid"/
// "terlalu panjang" dilakukan di PersistService (pra-transaksi, pesan Indonesia konsisten
// dengan validateFreeText & pola clean-400 lain di codebase ini), bukan di DTO ini.
export class PersistUploadDto {
  @ApiPropertyOptional({
    description:
      'JSON-encoded array hasil parse yang sudah direview (field multipart, string).',
  })
  @IsOptional()
  @IsString()
  rows?: string;

  @ApiPropertyOptional({ description: 'Nama file workbook original.' })
  @IsOptional()
  @IsString()
  original_filename?: string;

  @ApiPropertyOptional({ description: 'Catatan opsional level upload.' })
  @IsOptional()
  @IsString()
  description?: string;
}
