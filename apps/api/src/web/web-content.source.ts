import { Injectable } from '@nestjs/common';
import { CatalogService } from '../modules/catalog/catalog.service';
import { ContentService } from '../modules/content/content.service';
import type { CategoryLike, LegalDocLike, PostLike, SiteContentRowLike } from './content-view';

/**
 * WebController'ın içerik verisi kaynağı (F5) — arayüz sabit, uygulama ContentService + CatalogService üzerinden
 * (ADR-0002: web katmanı aynı servisleri kullanır; Prisma'ya doğrudan erişim YOK):
 * - getSiteContentRows()  → ContentService.getSiteContentRows() (registry ∪ DB şeması + ham değer; write-invalidate cache)
 * - getLegalCurrent()     → ContentService.getCurrentLegalDocuments() (≡ GET /api/v1/legal: isCurrent, showInNav dahil, gövdeli)
 * - getPublishedPosts()   → ContentService.getPublishedPosts() (tamamı; index ilk 3'ü alır)
 * - getCategories()       → CatalogService.listActiveCategories() (sekmeler + panel notları; Category.panelNote tek sahip [B11])
 * Admin yazımları ContentAdminService/CatalogAdminService cache düşürmesiyle bir sonraki render'da görünür.
 */
export interface WebContentSource {
  getSiteContentRows(): Promise<SiteContentRowLike[]>;
  getLegalCurrent(): Promise<LegalDocLike[]>;
  getPublishedPosts(): Promise<PostLike[]>;
  getCategories(): Promise<CategoryLike[]>;
}

export const WEB_CONTENT_SOURCE = Symbol('WEB_CONTENT_SOURCE');

/** gunluk.hbs tüm yayındaki yazıları basar — sayfalama yok; üst sınır (ContentService sayfalama parametresi). */
const ALL_POSTS_LIMIT = 1000;

@Injectable()
export class ContentSourceAdapter implements WebContentSource {
  constructor(
    private readonly content: ContentService,
    private readonly catalog: CatalogService,
  ) {}

  async getSiteContentRows(): Promise<SiteContentRowLike[]> {
    const rows = await this.content.getSiteContentRows();
    return Object.entries(rows).map(([key, row]) => ({ key, schema: row.schema, value: row.value }));
  }

  async getLegalCurrent(): Promise<LegalDocLike[]> {
    const docs = await this.content.getCurrentLegalDocuments();
    return docs.map((d) => ({
      slug: d.slug,
      kind: d.kind,
      title: d.title,
      version: d.version,
      leadHtml: d.leadHtml,
      bodyHtml: d.bodyHtml,
      effectiveFrom: new Date(d.effectiveFrom),
      requiresAck: d.requiresAck,
      showInNav: d.showInNav,
      sortOrder: d.sortOrder,
    }));
  }

  async getPublishedPosts(): Promise<PostLike[]> {
    const { items } = await this.content.getPublishedPosts({ limit: ALL_POSTS_LIMIT, page: 1 });
    return items.map((p) => ({
      slug: p.slug,
      kind: p.kind,
      readMinutes: p.readMinutes,
      titleHtml: p.titleHtml,
      bodyHtml: p.bodyHtml,
      publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
      coverPath: p.coverUrl,
      coverAlt: p.coverAlt,
    }));
  }

  async getCategories(): Promise<CategoryLike[]> {
    const rows = await this.catalog.listActiveCategories();
    return rows.map((c) => ({ slug: c.slug, label: c.label, panelNote: c.panelNote }));
  }
}
