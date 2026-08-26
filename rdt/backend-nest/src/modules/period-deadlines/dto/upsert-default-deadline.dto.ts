import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpsertDefaultDeadlineDto {
  @ApiProperty({ description: "Format 'YYYY-MM'." })
  @IsOptional()
  @IsString()
  periode?: string;

  @ApiProperty({ description: 'Tanggal/waktu deadline, ISO string.' })
  @IsOptional()
  @IsString()
  deadline_at?: string;
}
