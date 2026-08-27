import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { BaseController } from '../../../core/base.controller';
import { CurrentUser } from '../../../core/security/current-user.decorator';
import type { Identity } from '../../../core/security/identity.interface';
import { PersistUploadDto } from './dto/persist-upload.dto';
import { PersistService } from './persist.service';

/**
 * `repost/persist` — port `POST /api/persist` + `GET /api/uploads/:id/download`. 🔴 Zona
 * transaksi: upload → persist → confirm → export. Tak ada guard dinas di sini (sama seperti
 * `UploadController`'s `/parse`) -- `dinas_inisiasi`/`uploaded_by` diturunkan dari identity,
 * bukan dari param URL; `IdentityMiddleware` global sudah menjamin `req.identity` ada (401
 * dilempar provider-nya sendiri kalau tidak).
 */
@ApiTags('repost-persist')
@Controller('repost/persist')
export class PersistController extends BaseController {
  constructor(private readonly persist: PersistService) {
    super();
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Persist hasil review parse Format CBO ke rdt.transactions -- atomik, supersede upload lama.',
  })
  async persistUpload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: PersistUploadDto,
    @CurrentUser() user: Identity,
    @Req() req: Request,
  ) {
    const result = await this.persist.persist({
      rawRows: dto.rows,
      originalFilename: dto.original_filename,
      rawDescription: dto.description,
      file,
      user,
      ip: req.ip ?? null,
    });
    return this.ok(result);
  }

  @Get('uploads/:uploadId/download')
  @ApiOperation({
    summary:
      'Download workbook original byte-for-byte (bukan re-export) -- inisiator/target/TAB.',
  })
  async download(
    @Param('uploadId', ParseIntPipe) uploadId: number,
    @CurrentUser() user: Identity,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.persist.downloadOriginal(
      uploadId,
      user,
    );
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    return new StreamableFile(buffer);
  }
}
