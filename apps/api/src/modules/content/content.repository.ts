import { Injectable } from '@nestjs/common';
import { ContentStatus, Prisma, type Consent, type LegalDocument, type SiteContent } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * ContentRepository — SiteContent / Post / LegalDocument / Consent okuma-yazma; Prisma YALNIZ burada (ADR-0002).
 * İş kuralları (şema doğrulama, sürüm tekilliği, 404/409 kararları) ContentService/ContentAdminService'tedir.
 * Zaman: ham SQL yok; `now` parametre olarak gelir (ADR-0004).
 */

export const POST_INCLUDE = { coverMedia: { select: { path: true, thumbPath: true, alt: true } } } satisfies Prisma.PostInclude;
export type PostRecord = Prisma.PostGetPayload<{ include: typeof POST_INCLUDE }>;

/** Yayındaki yazıların sırası: publishedAt azalan → sortOrder artan → createdAt azalan (gunluk.html: en yeni üstte). */
const PUBLISHED_POST_ORDER: Prisma.PostOrderByWithRelationInput[] = [{ publishedAt: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }];

export interface AdminPostFilter {
  status?: ContentStatus;
  q?: string;
}

export interface SiteContentUpsertInput {
  label: string;
  schema: Prisma.InputJsonValue;
  value: Prisma.InputJsonValue;
  updatedBy: string | null;
}

export interface LegalNavPatchInput {
  showInNav?: boolean;
  sortOrder?: number;
  requiresAck?: boolean;
}

@Injectable()
export class ContentRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── SiteContent ─────────────────────────────────────────────────────────────

  findAllSiteContent(): Promise<SiteContent[]> {
    return this.prisma.siteContent.findMany({ orderBy: { key: 'asc' } });
  }

  findSiteContent(key: string): Promise<SiteContent | null> {
    return this.prisma.siteContent.findUnique({ where: { key } });
  }

  upsertSiteContent(key: string, data: SiteContentUpsertInput): Promise<SiteContent> {
    return this.prisma.siteContent.upsert({
      where: { key },
      create: { key, label: data.label, schema: data.schema, value: data.value, updatedBy: data.updatedBy },
      update: { label: data.label, schema: data.schema, value: data.value, updatedBy: data.updatedBy },
    });
  }

  // ── Post ────────────────────────────────────────────────────────────────────

  findPublishedPosts(): Promise<PostRecord[]> {
    return this.prisma.post.findMany({ where: { status: ContentStatus.PUBLISHED }, orderBy: PUBLISHED_POST_ORDER, include: POST_INCLUDE });
  }

  findPublishedPostBySlug(slug: string): Promise<PostRecord | null> {
    return this.prisma.post.findFirst({ where: { slug, status: ContentStatus.PUBLISHED }, include: POST_INCLUDE });
  }

  async findPosts(filter: AdminPostFilter, page: number, limit: number): Promise<{ rows: PostRecord[]; total: number }> {
    const where: Prisma.PostWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { slug: { contains: filter.q, mode: 'insensitive' } },
              { titleHtml: { contains: filter.q, mode: 'insensitive' } },
              { excerpt: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: POST_INCLUDE,
      }),
      this.prisma.post.count({ where }),
    ]);
    return { rows, total };
  }

  findPostById(id: string): Promise<PostRecord | null> {
    return this.prisma.post.findUnique({ where: { id }, include: POST_INCLUDE });
  }

  createPost(data: Prisma.PostUncheckedCreateInput): Promise<PostRecord> {
    return this.prisma.post.create({ data, include: POST_INCLUDE });
  }

  updatePost(id: string, data: Prisma.PostUncheckedUpdateInput): Promise<PostRecord> {
    return this.prisma.post.update({ where: { id }, data, include: POST_INCLUDE });
  }

  deletePost(id: string): Promise<void> {
    return this.prisma.post.delete({ where: { id } }).then(() => undefined);
  }

  mediaExists(id: string): Promise<boolean> {
    return this.prisma.mediaFile.findUnique({ where: { id }, select: { id: true } }).then((r) => r !== null);
  }

  // ── LegalDocument ───────────────────────────────────────────────────────────

  /** Yayındaki sürümler (slug başına en çok bir) — sortOrder → slug. */
  findCurrentLegal(): Promise<LegalDocument[]> {
    return this.prisma.legalDocument.findMany({ where: { isCurrent: true }, orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] });
  }

  findCurrentLegalBySlug(slug: string): Promise<LegalDocument | null> {
    return this.prisma.legalDocument.findFirst({ where: { slug, isCurrent: true } });
  }

  findLegalBySlugVersion(slug: string, version: number): Promise<LegalDocument | null> {
    return this.prisma.legalDocument.findUnique({ where: { slug_version: { slug, version } } });
  }

  findLegalById(id: string): Promise<LegalDocument | null> {
    return this.prisma.legalDocument.findUnique({ where: { id } });
  }

  /** Tüm sürümler: slug artan, sürüm azalan (admin gruplaması). */
  findAllLegal(): Promise<LegalDocument[]> {
    return this.prisma.legalDocument.findMany({ orderBy: [{ slug: 'asc' }, { version: 'desc' }] });
  }

  findLatestLegalVersion(slug: string): Promise<LegalDocument | null> {
    return this.prisma.legalDocument.findFirst({ where: { slug }, orderBy: { version: 'desc' } });
  }

  createLegal(data: Prisma.LegalDocumentUncheckedCreateInput): Promise<LegalDocument> {
    return this.prisma.legalDocument.create({ data });
  }

  updateLegal(id: string, data: Prisma.LegalDocumentUncheckedUpdateInput): Promise<LegalDocument> {
    return this.prisma.legalDocument.update({ where: { id }, data });
  }

  /** Yayınla: aynı slug'ın diğer sürümleri isCurrent=false, bu sürüm true + effectiveFrom — tek transaction. */
  async publishLegal(id: string, slug: string, effectiveFrom: Date): Promise<LegalDocument> {
    const [, published] = await this.prisma.$transaction([
      this.prisma.legalDocument.updateMany({ where: { slug, id: { not: id } }, data: { isCurrent: false } }),
      this.prisma.legalDocument.update({ where: { id }, data: { isCurrent: true, effectiveFrom } }),
    ]);
    return published;
  }

  /** nav/sıra/onay bayrakları slug'ın tüm sürümlerine uygulanır. */
  updateLegalNavBySlug(slug: string, data: LegalNavPatchInput): Promise<number> {
    return this.prisma.legalDocument
      .updateMany({
        where: { slug },
        data: {
          ...(data.showInNav !== undefined ? { showInNav: data.showInNav } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          ...(data.requiresAck !== undefined ? { requiresAck: data.requiresAck } : {}),
        },
      })
      .then((r) => r.count);
  }

  // ── Consent ─────────────────────────────────────────────────────────────────

  createConsent(data: Prisma.ConsentUncheckedCreateInput): Promise<Consent> {
    return this.prisma.consent.create({ data });
  }
}
