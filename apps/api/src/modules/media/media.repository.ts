import { Injectable } from '@nestjs/common';
import { Prisma, type MediaFile } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** Medya dosyasına referans veren varlıklar — DELETE öncesi 409 kararı için sayılır (BACKEND-PLANI §3 media). */
export const MEDIA_REF_INCLUDE = {
  _count: { select: { productImages: true, posts: true, producers: true, tiers: true } },
} satisfies Prisma.MediaFileInclude;
export type MediaFileWithRefs = Prisma.MediaFileGetPayload<{ include: typeof MEDIA_REF_INCLUDE }>;

export interface MediaListFilter {
  folder?: string;
  q?: string;
}

/**
 * MediaRepository — MediaFile okuma/yazma; Prisma YALNIZ burada (ADR-0002). Dosya sistemi işleri serviste.
 */
@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.MediaFileCreateInput): Promise<MediaFile> {
    return this.prisma.mediaFile.create({ data });
  }

  findById(id: string): Promise<MediaFile | null> {
    return this.prisma.mediaFile.findUnique({ where: { id } });
  }

  findByIdWithRefs(id: string): Promise<MediaFileWithRefs | null> {
    return this.prisma.mediaFile.findUnique({ where: { id }, include: MEDIA_REF_INCLUDE });
  }

  /** Liste: klasör filtresi + serbest arama (originalName / alt / path), en yeni önce. */
  async findMany(filter: MediaListFilter, page: number, limit: number): Promise<{ rows: MediaFile[]; total: number }> {
    const where: Prisma.MediaFileWhereInput = {
      ...(filter.folder ? { folder: filter.folder } : {}),
      ...(filter.q
        ? {
            OR: [
              { originalName: { contains: filter.q, mode: 'insensitive' } },
              { alt: { contains: filter.q, mode: 'insensitive' } },
              { path: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.mediaFile.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.mediaFile.count({ where }),
    ]);
    return { rows, total };
  }

  /** Kullanımdaki klasör adları (alfabetik). */
  findFolders(): Promise<string[]> {
    return this.prisma.mediaFile
      .findMany({ distinct: ['folder'], select: { folder: true }, orderBy: { folder: 'asc' } })
      .then((rows) => rows.map((r) => r.folder));
  }

  update(id: string, data: Prisma.MediaFileUpdateInput): Promise<MediaFile> {
    return this.prisma.mediaFile.update({ where: { id }, data });
  }

  delete(id: string): Promise<void> {
    return this.prisma.mediaFile.delete({ where: { id } }).then(() => undefined);
  }
}
