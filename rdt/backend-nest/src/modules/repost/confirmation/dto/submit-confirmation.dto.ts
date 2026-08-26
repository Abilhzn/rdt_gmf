import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SubmitDecisionDto {
  @ApiProperty({ description: 'rdt.transactions.id' })
  @IsInt()
  id!: number;

  @ApiProperty({ enum: ['YA', 'TIDAK'] })
  @IsIn(['YA', 'TIDAK'])
  claim!: 'YA' | 'TIDAK';

  @ApiPropertyOptional({
    description:
      'Dinas tujuan redirect kalau claim=TIDAK (opsional — tanpa ini jadi DECLINE biasa).',
  })
  @IsOptional()
  @IsString()
  redirect_to?: string;
}

export class SubmitConfirmationDto {
  @ApiProperty({ type: [SubmitDecisionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitDecisionDto)
  decisions!: SubmitDecisionDto[];

  // Validasi panjang/required sebenarnya ada di validateFreeText (3a) dalam service — di sini
  // cuma pastikan tipenya string kalau dikirim, biar pesan error yang "wajib diisi"/"terlalu
  // panjang" konsisten dengan field lain yang pakai validateFreeText.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
