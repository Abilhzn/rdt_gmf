import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AssignInvestigationDto {
  @ApiProperty({ description: 'Dinas tujuan hasil investigasi TAB.' })
  @IsString()
  @IsNotEmpty()
  dinas_target!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class AssignAllItemDto {
  @ApiProperty({ description: 'rdt.transactions.id' })
  @IsInt()
  transaction_id!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dinas_target!: string;
}

export class AssignAllDto {
  @ApiProperty({ type: [AssignAllItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignAllItemDto)
  items!: AssignAllItemDto[];

  // Satu description opsional, jadi satu komentar per pasangan (dinas_inisiasi, dinas_target) distinct.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
