import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { MediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';

/**
 * MediaModule (F4) — medya kütüphanesi: yükleme (multer+sharp→webp), liste, düzenleme, silme (ADR-0002 dilimi).
 * AppModule'e import'u A ekler; `/uploads/*` statik servisi main.ts'te (D). `media:import` CLI: apps/api/scripts/media-import.ts.
 */
@Module({
  imports: [PrismaModule],
  controllers: [MediaController],
  providers: [MediaRepository, MediaService],
  exports: [MediaService],
})
export class MediaModule {}
