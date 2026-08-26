import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class PostPairCommentDto {
  // Required-ness + length-cap dicek `validateFreeText` (3a) di service, bukan cuma
  // `@IsNotEmpty` DTO -- sama pola dengan field free-text lain di codebase ini.
  @ApiProperty({ description: 'Isi komentar.' })
  @IsString()
  body!: string;

  @ApiPropertyOptional({
    description:
      'Reply ke comment ini (inherit transaction_id parent-nya) -- tanpa ini, top-level baru.',
  })
  @IsOptional()
  @IsInt()
  parent_comment_id?: number;
}
