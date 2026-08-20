import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  ConsentCreateInput,
  ConsentCreated,
  ContentSchema,
  LegalDocument as LegalDocumentDto,
  LegalNavItem,
  PublicPost,
  PublicPostList,
} from '@bagdam/shared';
import type { Cache } from 'cache-manager';
import { CONTENT_CACHE_KEYS, CONTENT_CACHE_TTL_MS, DEFAULT_CONSENT_SOURCE, POSTS_PUBLIC_DEFAULT_LIMIT } from './content.constants';
import { resolveSiteContentSchema, toLegalDocument, toLegalNavItem, toPublicPost } from './content.mapper';
import { ContentRepository } from './content.repository';
import { getSiteContentRegistryEntry } from './site-content.registry';
import { escapeContentValue, toSiteContentTree } from './site-content.schema';

/** Cache'teki SiteContent satırı: etkin şema (registry ∪ DB) + ham değer. */
export interface SiteContentRow {
  schema: ContentSchema | null;
  value: unknown;
}

/** `POST /consents` bağlamı — controller istekten çıkarır (ip/ua/oturum). */
export interface ConsentContext {
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** sitemap.xml için yazı özeti. */
export interface SitemapPost {
  slug: string;
  lastmod: Date;
}

/**
 * ContentService — içerik OKUMA + onay kaydı; WebController, public uçlar ve sitemap aynı servisi kullanır (ADR-0002).
 * - SiteContent satırları / yasal nav / yayındaki yazılar in-process cache'te (CacheModule @Global, TTL 5 dk);
 *   ContentAdminService her yazımda ilgili anahtarı düşürür (`invalidate*`).
 * - `getSiteContentMap()` ham değerler (key → value, sözleşme); `getSiteContentForViews()` şablon için: noktalı
 *   anahtarlar ağaç, richtext dışındaki metinler escapeHtml (piksel parite: ' kaçışlanmaz).
 * - Yayın kuralları: yazılar yalnız PUBLISHED; yasal belgeler `isCurrent`, nav = showInNav.
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly repo: ContentRepository,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ── SiteContent ─────────────────────────────────────────────────────────────

  /** Tüm satırlar (cache'li): key → {schema, value}. */
  async getSiteContentRows(): Promise<Record<string, SiteContentRow>> {
    const cached = await this.cache.get<Record<string, SiteContentRow>>(CONTENT_CACHE_KEYS.siteContentRows);
    if (cached) return cached;
    const rows = await this.repo.findAllSiteContent();
    const map: Record<string, SiteContentRow> = {};
    for (const row of rows) {
      map[row.key] = { schema: resolveSiteContentSchema(getSiteContentRegistryEntry(row.key), row), value: row.value };
    }
    await this.cache.set(CONTENT_CACHE_KEYS.siteContentRows, map, CONTENT_CACHE_TTL_MS);
    return map;
  }

  /** Sözleşme: tüm anahtarlar key → value (ham; `GET /site-content`). */
  async getSiteContentMap(): Promise<Record<string, unknown>> {
    const rows = await this.getSiteContentRows();
    const out: Record<string, unknown> = {};
    for (const [key, row] of Object.entries(rows)) out[key] = row.value;
    return out;
  }

  /** Tek anahtarın ham değeri (`GET /site-content/:key`); yoksa 404. */
  async getSiteContent(key: string): Promise<unknown> {
    const rows = await this.getSiteContentRows();
    const row = rows[key];
    if (!row) throw new NotFoundException(`İçerik bloğu bulunamadı: ${key}`);
    return row.value;
  }

  /**
   * Şablon bağlamı: `{ promoBar: {...}, home: { hero: {...}, … }, footer: {...} }` — richtext ham, diğer metinler
   * kaçışlanmış; şablon her alanı `{{{ }}}` ile basar. WebController (C) `site` olarak verir.
   */
  async getSiteContentForViews(): Promise<Record<string, unknown>> {
    const rows = await this.getSiteContentRows();
    const flat: Record<string, unknown> = {};
    for (const [key, row] of Object.entries(rows)) flat[key] = escapeContentValue(row.schema, row.value);
    return toSiteContentTree(flat);
  }

  async invalidateSiteContentCache(): Promise<void> {
    await this.safeDel(CONTENT_CACHE_KEYS.siteContentRows);
  }

  // ── Yasal belgeler ──────────────────────────────────────────────────────────

  /** Yayındaki belgeler (tam; bodyHtml dahil) — `GET /legal`. */
  async getCurrentLegalDocuments(): Promise<LegalDocumentDto[]> {
    const cached = await this.cache.get<LegalDocumentDto[]>(CONTENT_CACHE_KEYS.legalCurrent);
    if (cached) return cached;
    const docs = (await this.repo.findCurrentLegal()).map(toLegalDocument);
    await this.cache.set(CONTENT_CACHE_KEYS.legalCurrent, docs, CONTENT_CACHE_TTL_MS);
    return docs;
  }

  /** politikalar nav: isCurrent && showInNav, sortOrder → slug. */
  async getLegalNav(): Promise<LegalNavItem[]> {
    const cached = await this.cache.get<LegalNavItem[]>(CONTENT_CACHE_KEYS.legalNav);
    if (cached) return cached;
    const rows = await this.repo.findCurrentLegal();
    const nav = rows.filter((r) => r.showInNav).map(toLegalNavItem);
    await this.cache.set(CONTENT_CACHE_KEYS.legalNav, nav, CONTENT_CACHE_TTL_MS);
    return nav;
  }

  /** `version` verilmezse yayındaki sürüm; verilirse o sürüm (yayında olmasa da — onay kaydı/arşiv). Yoksa 404. */
  async getLegalBySlug(slug: string, version?: number): Promise<LegalDocumentDto> {
    const row = version === undefined ? await this.repo.findCurrentLegalBySlug(slug) : await this.repo.findLegalBySlugVersion(slug, version);
    if (!row) {
      throw new NotFoundException(version === undefined ? `Yasal metin bulunamadı: ${slug}` : `Yasal metin bulunamadı: ${slug} v${version}`);
    }
    return toLegalDocument(row);
  }

  async invalidateLegalCache(): Promise<void> {
    await Promise.all([this.safeDel(CONTENT_CACHE_KEYS.legalNav), this.safeDel(CONTENT_CACHE_KEYS.legalCurrent)]);
  }

  // ── Günlük (Post) ───────────────────────────────────────────────────────────

  /** Yayındaki tüm yazılar (cache'li; publishedAt azalan). */
  private async getAllPublishedPosts(): Promise<PublicPost[]> {
    const cached = await this.cache.get<PublicPost[]>(CONTENT_CACHE_KEYS.publishedPosts);
    if (cached) return cached;
    const posts = (await this.repo.findPublishedPosts()).map(toPublicPost);
    await this.cache.set(CONTENT_CACHE_KEYS.publishedPosts, posts, CONTENT_CACHE_TTL_MS);
    return posts;
  }

  /** `GET /posts?limit&page` → {items,total}; index için limit 3, gunluk için büyük limit. */
  async getPublishedPosts(opts: { limit?: number; page?: number } = {}): Promise<PublicPostList> {
    const limit = opts.limit ?? POSTS_PUBLIC_DEFAULT_LIMIT;
    const page = opts.page ?? 1;
    const all = await this.getAllPublishedPosts();
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit), total: all.length };
  }

  async getPostBySlug(slug: string): Promise<PublicPost> {
    const row = await this.repo.findPublishedPostBySlug(slug);
    if (!row) throw new NotFoundException(`Yazı bulunamadı: ${slug}`);
    return toPublicPost(row);
  }

  /** sitemap.xml: yayındaki yazıların slug + son değişiklik. */
  async getSitemapPosts(): Promise<SitemapPost[]> {
    const all = await this.getAllPublishedPosts();
    return all.map((p) => ({ slug: p.slug, lastmod: new Date(p.updatedAt) }));
  }

  async invalidatePostsCache(): Promise<void> {
    await this.safeDel(CONTENT_CACHE_KEYS.publishedPosts);
  }

  // ── Onaylar ─────────────────────────────────────────────────────────────────

  /**
   * Onay kaydı: belge slug'ı verildiyse (sürümle ya da yayındaki) documentId bağlanır; yoksa 404.
   * ip/ua/userId bağlamdan; source varsayılan HS_WEB; iysStatus şema varsayılanı (NOT_APPLICABLE — İYS P2).
   */
  async recordConsent(input: ConsentCreateInput, ctx: ConsentContext = {}): Promise<ConsentCreated> {
    let documentId: string | null = null;
    if (input.documentSlug) {
      const doc =
        input.documentVersion === undefined
          ? await this.repo.findCurrentLegalBySlug(input.documentSlug)
          : await this.repo.findLegalBySlugVersion(input.documentSlug, input.documentVersion);
      if (!doc) throw new NotFoundException(`Onay verilecek yasal metin bulunamadı: ${input.documentSlug}`);
      documentId = doc.id;
    }
    const row = await this.repo.createConsent({
      userId: ctx.userId ?? null,
      guestKey: input.guestKey ?? null,
      kind: input.kind,
      documentId,
      granted: input.granted ?? true,
      source: input.source ?? DEFAULT_CONSENT_SOURCE,
      ipAddress: ctx.ip ? ctx.ip.slice(0, 64) : null,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
    });
    return { id: row.id };
  }

  // ── Yardımcılar ─────────────────────────────────────────────────────────────

  private async safeDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (err) {
      // Düşürme başarısızsa TTL (5 dk) sonunda kendiliğinden yenilenir; mutasyon geri alınmaz.
      this.logger.warn(`Cache düşürülemedi (${key}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
