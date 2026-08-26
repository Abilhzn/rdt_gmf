import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

// `splits` sengaja dibiarkan `unknown[]` -- validasi per-baris (dinas_target wajib, nominal
// harus tipe number asli/finite/bukan nol) dilakukan di service, port PERSIS pesan error kode
// lama (bukan pesan generik class-validator, dan bukan implicit numeric-string coercion).
export class SplitTransactionDto {
  @ApiProperty({
    description: 'Array {dinas_target, nominal} -- minimal 2 baris.',
    type: [Object],
  })
  @IsArray()
  splits!: unknown[];

  @ApiPropertyOptional({
    description: 'Alasan split -- wajib diisi (dicek di service).',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
