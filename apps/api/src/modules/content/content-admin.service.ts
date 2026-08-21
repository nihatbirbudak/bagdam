import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminLegalGroup, AdminPostList, AdminSiteContentItem, LegalDocument as LegalDocumentDto, Post as PostDto } from '@bagdam/shared';
import { ContentStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { sanitizeRichHtml, sanitizeRichHtmlOrNull } from '../../common/security/html-sanitize';
import { ADMIN_DEFAULT_LIMIT, ADMIN_DEFAULT_PAGE } from './content.constants';
import { groupLegalDocuments, resolveSiteContentSchema, toAdminPost, toAdminSiteContentItem, toLegalDocument } from './content.mapper';
import { ContentRepository } from './content.repository';
import { ContentService } from './content.service';
import type { CreateLegalVersionDto, LegalNavPatchDto, PublishLegalDto, UpdateLegalDto } from './dto/legal.dto';
import type { AdminPostQueryDto, CreatePostDto, UpdatePostDto } from './dto/post.dto';
import { getSiteContentRegistryEntry, SITE_CONTENT_REGISTRY } from './site-content.registry';
import { validateContentValue } from './site-content.schema';

/** Prisma bilinen hata kodu (P2002 unique · P2025 kayıt yok). */
function prismaCode(err: unknown): string | null {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
}

/** LegalDocument.contentHash — gövdenin SHA-256'sı (hangi metne onay verildi). */
export function legalContentHash(bodyHtml: string): string {
  return createHash('sha256').update(bodyHtml, 'utf8').digest('hex');
}

/**
 * ContentAdminService — içerik admin iş kuralları (BACKEND-PLANI §3 content admin satırı, §4 ekran 9–12).
 * - SiteContent: şema registry'den (yoksa DB satırından); PUT değeri şemaya göre doğrulanır (400), satır upsert edilir
 *   (registry etiketi/şeması DB'ye yazılır), okuma cache'i düşer.
 * - Post: slug tekil (409), kapak medyası var olmalı (404), PUBLISHED'a geçişte publishedAt dolar; hard delete.
 * - LegalDocument: yeni sürüm = max+1 taslak; yalnız taslak düzenlenir (yayındakinde 409); publish tek transaction
 *   (slug'ta tek isCurrent); nav/sıra/onay slug'ın tüm sürümlerine.
 * Her mutasyon ContentService'in ilgili cache'ini düşürür.
 */
@Injectable()
export class ContentAdminService {
  constructor(
    private readonly repo: ContentRepository,
    private readonly content: ContentService,
  ) {}

  // ── SiteContent ─────────────────────────────────────────────────────────────

  /** Registry sırası + registry dışı DB anahtarları (alfabetik). */
  async listSiteContent(): Promise<AdminSiteContentItem[]> {
    const rows = await this.repo.findAllSiteContent();
    const byKey = new Map(rows.map((r) => [r.key, r] as const));
    const items: AdminSiteContentItem[] = SITE_CONTENT_REGISTRY.map((entry) => toAdminSiteContentItem(entry, byKey.get(entry.key) ?? null));
    for (const row of rows) {
      if (!getSiteContentRegistryEntry(row.key)) items.push(toAdminSiteContentItem(undefined, row));
    }
    return items;
  }

  async getSiteContent(key: string): Promise<AdminSiteContentItem> {
    const entry = getSiteContentRegistryEntry(key);
    const row = await this.repo.findSiteContent(key);
    if (!entry && !row) throw new NotFoundException(`İçerik bloğu bulunamadı: ${key}`);
    return toAdminSiteContentItem(entry, row);
  }

  /** Şemaya göre doğrula → upsert → cache düşür. `updatedBy` oturum kullanıcısı. */
  async updateSiteContent(key: string, value: unknown, updatedBy: string | null): Promise<AdminSiteContentItem> {
    const entry = getSiteContentRegistryEntry(key);
    const row = await this.repo.findSiteContent(key);
    const schema = resolveSiteContentSchema(entry, row);
    if (!schema) throw new NotFoundException(`İçerik bloğu bulunamadı: ${key}`);
    const clean = validateContentValue(schema, value);
    const saved = await this.repo.upsertSiteContent(key, {
      label: entry?.label ?? row?.label ?? key,
      schema: schema as unknown as Prisma.InputJsonValue,
      value: clean as Prisma.InputJsonValue,
      updatedBy,
    });
    await this.content.invalidateSiteContentCache();
    return toAdminSiteContentItem(entry, saved);
  }

  // ── Post ────────────────────────────────────────────────────────────────────

  async listPosts(query: AdminPostQueryDto): Promise<AdminPostList> {
    const page = query.page ?? ADMIN_DEFAULT_PAGE;
    const limit = query.limit ?? ADMIN_DEFAULT_LIMIT;
    const { rows, total } = await this.repo.findPosts({ status: query.status, q: query.q || undefined }, page, limit);
    return { items: rows.map(toAdminPost), total, page, limit };
  }

  async getPost(id: string): Promise<PostDto> {
    const row = await this.repo.findPostById(id);
    if (!row) throw new NotFoundException('Yazı bulunamadı');
    return toAdminPost(row);
  }

  async createPost(dto: CreatePostDto): Promise<PostDto> {
    await this.assertCover(dto.coverMediaId ?? null);
    const status = dto.status ?? ContentStatus.DRAFT;
    const publishedAt = this.resolvePublishedAt(dto.publishedAt, status, null);
    try {
      const row = await this.repo.createPost({
        slug: dto.slug,
        kind: dto.kind,
        readMinutes: dto.readMinutes ?? 4,
        titleHtml: sanitizeRichHtml(dto.titleHtml),
        excerpt: dto.excerpt ?? null,
        bodyHtml: sanitizeRichHtml(dto.bodyHtml),
        coverMediaId: dto.coverMediaId ?? null,
        relatedSlugs: dto.relatedSlugs ?? [],
        status,
        publishedAt,
        sortOrder: dto.sortOrder ?? 0,
      });
      await this.content.invalidatePostsCache();
      return toAdminPost(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu slug zaten kullanılıyor: ${dto.slug}`);
      throw err;
    }
  }

  async updatePost(id: string, dto: UpdatePostDto): Promise<PostDto> {
    const existing = await this.repo.findPostById(id);
    if (!existing) throw new NotFoundException('Yazı bulunamadı');
    if (dto.coverMediaId) await this.assertCover(dto.coverMediaId);
    const status = dto.status ?? existing.status;
    const data: Prisma.PostUncheckedUpdateInput = {
      ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      ...(dto.readMinutes !== undefined ? { readMinutes: dto.readMinutes } : {}),
      ...(dto.titleHtml !== undefined ? { titleHtml: sanitizeRichHtml(dto.titleHtml) } : {}),
      ...(dto.excerpt !== undefined ? { excerpt: dto.excerpt } : {}),
      ...(dto.bodyHtml !== undefined ? { bodyHtml: sanitizeRichHtml(dto.bodyHtml) } : {}),
      ...(dto.coverMediaId !== undefined ? { coverMediaId: dto.coverMediaId } : {}),
      ...(dto.relatedSlugs !== undefined ? { relatedSlugs: dto.relatedSlugs } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    };
    // publishedAt: açıkça verildiyse o; PUBLISHED'a geçiyor ve tarih yoksa şimdi.
    if (dto.publishedAt !== undefined) data.publishedAt = this.resolvePublishedAt(dto.publishedAt, status, existing.publishedAt);
    else if (status === ContentStatus.PUBLISHED && !existing.publishedAt) data.publishedAt = new Date();
    try {
      const row = await this.repo.updatePost(id, data);
      await this.content.invalidatePostsCache();
      return toAdminPost(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu slug zaten kullanılıyor: ${dto.slug ?? ''}`);
      throw err;
    }
  }

  /** Yayınla: status PUBLISHED, publishedAt yoksa şimdi (geriye dönük tarih korunur). */
  async publishPost(id: string): Promise<PostDto> {
    const existing = await this.repo.findPostById(id);
    if (!existing) throw new NotFoundException('Yazı bulunamadı');
    const row = await this.repo.updatePost(id, { status: ContentStatus.PUBLISHED, publishedAt: existing.publishedAt ?? new Date() });
    await this.content.invalidatePostsCache();
    return toAdminPost(row);
  }

  /** Hard delete (Post'ta deletedAt yok). */
  async deletePost(id: string): Promise<void> {
    if (!(await this.repo.findPostById(id))) throw new NotFoundException('Yazı bulunamadı');
    await this.repo.deletePost(id);
    await this.content.invalidatePostsCache();
  }

  // ── LegalDocument ───────────────────────────────────────────────────────────

  async listLegal(): Promise<AdminLegalGroup[]> {
    return groupLegalDocuments(await this.repo.findAllLegal());
  }

  async getLegal(id: string): Promise<LegalDocumentDto> {
    const row = await this.repo.findLegalById(id);
    if (!row) throw new NotFoundException('Yasal metin bulunamadı');
    return toLegalDocument(row);
  }

  /**
   * Yeni taslak sürüm: version = max+1 (yeni slug'da 1 — `kind` zorunlu), isCurrent=false, effectiveFrom şimdi
   * (yayınla'da gerçek tarih). Bayraklar verilmezse yayındaki (yoksa en son) sürümden miras.
   */
  async createLegalVersion(slug: string, dto: CreateLegalVersionDto): Promise<LegalDocumentDto> {
    // F10: gövde/lead panelden gelir ve politikalar.hbs'te HAM basılır → betik taşıyan yapılar burada düşer.
    const bodyHtml = sanitizeRichHtml(dto.bodyHtml);
    const latest = await this.repo.findLatestLegalVersion(slug);
    const current = latest ? await this.repo.findCurrentLegalBySlug(slug) : null;
    const base = current ?? latest;
    if (!base && !dto.kind) throw new BadRequestException(`Yeni yasal metin için kind zorunlu: ${slug}`);
    const kind = base ? base.kind : dto.kind!;
    try {
      const row = await this.repo.createLegal({
        kind,
        slug,
        title: dto.title,
        version: latest ? latest.version + 1 : 1,
        leadHtml: sanitizeRichHtmlOrNull(dto.leadHtml ?? null),
        bodyHtml,
        contentHash: legalContentHash(bodyHtml),
        effectiveFrom: new Date(),
        isCurrent: false,
        requiresAck: dto.requiresAck ?? base?.requiresAck ?? false,
        showInNav: dto.showInNav ?? base?.showInNav ?? false,
        sortOrder: dto.sortOrder ?? base?.sortOrder ?? 0,
      });
      return toLegalDocument(row);
    } catch (err) {
      // Eşzamanlı iki taslak aynı sürüm numarasını aldıysa (slug+version unique) — yeniden denemesi istenir.
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Sürüm çakıştı, yeniden deneyin: ${slug}`);
      throw err;
    }
  }

  /** Yalnız taslak: yayındaki sürümün metni değişmez (onaylar o metne bağlı) → 409. */
  async updateLegal(id: string, dto: UpdateLegalDto): Promise<LegalDocumentDto> {
    const existing = await this.repo.findLegalById(id);
    if (!existing) throw new NotFoundException('Yasal metin bulunamadı');
    if (existing.isCurrent) {
      throw new ConflictException({ message: 'Yayındaki sürüm düzenlenemez; yeni sürüm oluşturun.', error: 'LEGAL_CURRENT_LOCKED' });
    }
    const row = await this.repo.updateLegal(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.leadHtml !== undefined ? { leadHtml: sanitizeRichHtmlOrNull(dto.leadHtml) } : {}),
      ...(dto.bodyHtml !== undefined
        ? { bodyHtml: sanitizeRichHtml(dto.bodyHtml), contentHash: legalContentHash(sanitizeRichHtml(dto.bodyHtml)) }
        : {}),
    });
    return toLegalDocument(row);
  }

  /** Yayınla: aynı slug'ta diğer sürümler isCurrent=false; effectiveFrom verilmezse şimdi. Zaten yayındaysa yalnız tarih güncellenir. */
  async publishLegal(id: string, dto: PublishLegalDto): Promise<LegalDocumentDto> {
    const existing = await this.repo.findLegalById(id);
    if (!existing) throw new NotFoundException('Yasal metin bulunamadı');
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) throw new BadRequestException('effectiveFrom geçersiz tarih');
    const row = await this.repo.publishLegal(id, existing.slug, effectiveFrom);
    await this.content.invalidateLegalCache();
    return toLegalDocument(row);
  }

  /** nav/sıra/onay → slug'ın tüm sürümleri (belge düzeyi özellik); döner: istenen sürümün güncel hâli. */
  async patchLegalNav(id: string, dto: LegalNavPatchDto): Promise<LegalDocumentDto> {
    const existing = await this.repo.findLegalById(id);
    if (!existing) throw new NotFoundException('Yasal metin bulunamadı');
    if (dto.showInNav === undefined && dto.sortOrder === undefined && dto.requiresAck === undefined) {
      throw new BadRequestException('En az bir alan gerekli: showInNav, sortOrder, requiresAck');
    }
    await this.repo.updateLegalNavBySlug(existing.slug, { showInNav: dto.showInNav, sortOrder: dto.sortOrder, requiresAck: dto.requiresAck });
    await this.content.invalidateLegalCache();
    const row = await this.repo.findLegalById(id);
    if (!row) throw new NotFoundException('Yasal metin bulunamadı');
    return toLegalDocument(row);
  }

  // ── Yardımcılar ─────────────────────────────────────────────────────────────

  private async assertCover(mediaId: string | null): Promise<void> {
    if (mediaId && !(await this.repo.mediaExists(mediaId))) throw new NotFoundException('Kapak görseli (medya) bulunamadı');
  }

  /** ISO string → Date; null → null; verilmemiş → PUBLISHED ise mevcut ?? şimdi, değilse mevcut. */
  private resolvePublishedAt(input: string | null | undefined, status: ContentStatus, existing: Date | null): Date | null {
    if (input === null) return null;
    if (typeof input === 'string') {
      const d = new Date(input);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('publishedAt geçersiz tarih');
      return d;
    }
    if (status === ContentStatus.PUBLISHED) return existing ?? new Date();
    return existing;
  }
}
