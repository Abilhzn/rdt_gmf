import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString } from 'class-validator';

export class AddSubdocDto {
  // Wajib non-kosong SETELAH TRIM -- validasi trim di service, bukan di sini (sama pola dengan
  // ConfirmExportDto.subdoc_number).
  @ApiProperty({ description: 'Nomor referensi SAP buat subdoc tambahan ini.' })
  @IsString()
  subdoc_number!: string;

  @ApiPropertyOptional({
    description:
      'Subset id transaksi yang belum ter-cover subdoc lain (opsional -- default semua yang unassigned).',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  transaction_ids?: number[];
}
