import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class ReplaceExclusionsDto {
  @ApiProperty({ type: [String], example: ['AUAK', 'PO'] })
  @IsArray()
  @IsString({ each: true })
  prefixes!: string[];
}
