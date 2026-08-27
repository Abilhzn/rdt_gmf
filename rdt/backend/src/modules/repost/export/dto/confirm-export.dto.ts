import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class ConfirmExportDto {
  @ApiProperty({ description: 'Kode dinas pengaju (dinas_inisiasi).' })
  @IsString()
  @IsNotEmpty()
  dinas_inisiasi!: string;

  @ApiProperty({ description: 'Kode dinas tujuan (dinas_target).' })
  @IsString()
  @IsNotEmpty()
  dinas_target!: string;

  // Opsional, tapi kalau diisi tetap kena length-cap validateFreeText (3a) di service.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  closing_description?: string;

  // Wajib non-kosong SETELAH TRIM ("   " lolos @IsNotEmpty tapi tidak valid) — validasi trim
  // dilakukan di service, bukan di sini.
  @ApiProperty({
    description:
      'Nomor referensi SAP — representasi "sudah post ke SAP", bukan sekadar approval.',
  })
  @IsString()
  subdoc_number!: string;

  @ApiPropertyOptional({
    description:
      'Subset id transaksi buat subdoc pertama (opsional — default semua baris yang baru di-attach).',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  transaction_ids?: number[];
}
