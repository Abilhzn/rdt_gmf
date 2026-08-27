import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ParseUploadDto {
  @ApiProperty({
    description: 'Kode dinas pengunggah (dinas_inisiasi), mis. "TB".',
  })
  @IsString()
  @IsNotEmpty()
  uploaderDinas!: string;
}
