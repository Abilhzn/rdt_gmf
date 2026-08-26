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

export class ResolveDeclinedDto {
  @ApiProperty({ enum: ['BORNE', 'REASSIGN'] })
  @IsIn(['BORNE', 'REASSIGN'])
  action!: 'BORNE' | 'REASSIGN';

  @ApiPropertyOptional({ description: 'Wajib kalau action=REASSIGN.' })
  @IsOptional()
  @IsString()
  new_dinas_target?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class BatchResolveItemDto {
  @ApiProperty({ description: 'rdt.transactions.id' })
  @IsInt()
  id!: number;

  @ApiProperty({ enum: ['BORNE', 'REASSIGN'] })
  @IsIn(['BORNE', 'REASSIGN'])
  action!: 'BORNE' | 'REASSIGN';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  new_dinas_target?: string;
}

export class BatchResolveDto {
  @ApiProperty({ type: [BatchResolveItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchResolveItemDto)
  items!: BatchResolveItemDto[];

  // Satu note opsional, dipakai bersama untuk semua item dalam batch.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
