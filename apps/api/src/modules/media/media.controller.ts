import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AdminMediaFile, AdminMediaList } from '@bagdam/shared';
import { Audited } from '../../common/decorators/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MediaIdParamDto } from './dto/media-id-param.dto';
import { MediaPatchDto } from './dto/media-patch.dto';
import { MediaQueryDto } from './dto/media-query.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MEDIA_ALLOWED_MIME_TYPES, MEDIA_MAX_UPLOAD_BYTES } from './media.constants';
import { MediaService, type UploadedFileLike } from './media.service';

/**
 * MediaController — `/api/v1/admin/media` (BACKEND-PLANI §3 media; §4 ekran 8 + picker).
 * Class-level `@Roles('ADMIN','STAFF')` + `@Audited('media')`. multer MemoryStorage (20 MB, 1 dosya, yalnız raster görsel);
 * dönüştürme/kaydetme MediaService'te. Statik servis `/uploads/*` main.ts'te (useStaticAssets — D ekler).
 */
@Controller('admin/media')
@Roles('ADMIN', 'STAFF')
@Audited('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MEDIA_MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (MEDIA_ALLOWED_MIME_TYPES.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException(`Desteklenmeyen dosya türü: ${file.mimetype} (jpeg/png/webp/gif/avif/tiff)`), false);
      },
    }),
  )
  upload(@UploadedFile() file: UploadedFileLike | undefined, @Body() dto: UploadMediaDto): Promise<AdminMediaFile> {
    return this.media.upload(file, dto);
  }

  @Get()
  list(@Query() query: MediaQueryDto): Promise<AdminMediaList> {
    return this.media.list(query);
  }

  @Get(':id')
  get(@Param() params: MediaIdParamDto): Promise<AdminMediaFile> {
    return this.media.get(params.id);
  }

  @Patch(':id')
  patch(@Param() params: MediaIdParamDto, @Body() dto: MediaPatchDto): Promise<AdminMediaFile> {
    return this.media.patch(params.id, dto);
  }

  /** Referans varsa 409 {message}; yoksa kayıt + dosya silinir → 204. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: MediaIdParamDto): Promise<void> {
    return this.media.remove(params.id);
  }
}
