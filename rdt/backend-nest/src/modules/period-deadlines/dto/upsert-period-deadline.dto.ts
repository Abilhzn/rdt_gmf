import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Semua field longgar (@IsOptional string) dengan sengaja -- "wajib"/"format YYYY-MM"/"tanggal
// valid"/"dinas aktif dikenal" dicek di service, biar pesan errornya persis sama dengan
// `routes/periodDeadlines.js` (port faithful), bukan pesan generik class-validator.
export class UpsertPeriodDeadlineDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  dinas_inisiasi?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  dinas_target?: string;

  @ApiProperty({ description: "Format 'YYYY-MM'." })
  @IsOptional()
  @IsString()
  periode?: string;

  @ApiProperty({ description: 'Tanggal/waktu deadline, ISO string.' })
  @IsOptional()
  @IsString()
  deadline_at?: string;
}
