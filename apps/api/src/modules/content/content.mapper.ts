import {
  DEFAULT_TZ,
  type AdminLegalGroup,
  type AdminLegalVersion,
  type AdminSiteContentItem,
  type ContentSchema,
  type LegalDocument as LegalDocumentDto,
  type LegalNavItem,
  type Post as PostDto,
  type PublicPost,
} from '@bagdam/shared';
import type { LegalDocument, SiteContent } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { toPublicUrl, toSiteMediaPath } from '../media/media.mapper';
import type { PostRecord } from './content.repository';
import { normalizeContentSchema } from './site-content.schema';
import type { SiteContentRegistryEntry } from './site-content.registry';

/**
 * ContentMapper — DB kaydı → @bagdam/shared DTO'ları (ADR-0002 mapper katmanı). Saf fonksiyonlar.
 * Görsel URL kuralı tek yerde (media.mapper): public yazılar site-göreli (`assets/…`, şablon paritesi),
 * admin yazıları mutlak (`/uploads/…`, `/assets/…`).
 */

function toPost(row: PostRecord, urlOf: (path: string | null | undefined) => string | null): PostDto {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    readMinutes: row.readMinutes,
    titleHtml: row.titleHtml,
    excerpt: row.excerpt,
    bodyHtml: row.bodyHtml,
    coverMediaId: row.coverMediaId,
    coverUrl: urlOf(row.coverMedia?.path),
    relatedSlugs: row.relatedSlugs,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** gunluk.html meta tarihi: "16.08.2026" (Europe/Istanbul takvim günü). */
export function formatPublishedDate(date: Date | null): string | null {
  return date ? formatInTimeZone(date, DEFAULT_TZ, 'dd.MM.yyyy') : null;
}

export function toPublicPost(row: PostRecord): PublicPost {
  return { ...toPost(row, toSiteMediaPath), publishedDateLabel: formatPublishedDate(row.publishedAt), coverAlt: row.coverMedia?.alt ?? null };
}

export function toAdminPost(row: PostRecord): PostDto {
  return toPost(row, toPublicUrl);
}

export function toLegalDocument(row: LegalDocument): LegalDocumentDto {
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    title: row.title,
    version: row.version,
    leadHtml: row.leadHtml,
    bodyHtml: row.bodyHtml,
    contentHash: row.contentHash,
    effectiveFrom: row.effectiveFrom.toISOString(),
    isCurrent: row.isCurrent,
    requiresAck: row.requiresAck,
    showInNav: row.showInNav,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLegalNavItem(row: LegalDocument): LegalNavItem {
  return { slug: row.slug, title: row.title, kind: row.kind, version: row.version, sortOrder: row.sortOrder, requiresAck: row.requiresAck };
}

export function toAdminLegalVersion(row: LegalDocument): AdminLegalVersion {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    isCurrent: row.isCurrent,
    effectiveFrom: row.effectiveFrom.toISOString(),
    requiresAck: row.requiresAck,
    showInNav: row.showInNav,
    sortOrder: row.sortOrder,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Tüm sürümler (slug artan, sürüm azalan) → slug başına grup. Başlık/bayraklar yayındaki sürümden, yayın yoksa en
 * son sürümden. Gruplar sortOrder → slug sırasıyla.
 */
export function groupLegalDocuments(rows: LegalDocument[]): AdminLegalGroup[] {
  const bySlug = new Map<string, LegalDocument[]>();
  for (const row of rows) {
    const list = bySlug.get(row.slug);
    if (list) list.push(row);
    else bySlug.set(row.slug, [row]);
  }
  const groups: AdminLegalGroup[] = [];
  for (const [slug, versions] of bySlug) {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const head = sorted.find((v) => v.isCurrent) ?? sorted[0]!;
    groups.push({
      slug,
      kind: head.kind,
      title: head.title,
      currentVersion: sorted.find((v) => v.isCurrent)?.version ?? null,
      showInNav: head.showInNav,
      sortOrder: head.sortOrder,
      requiresAck: head.requiresAck,
      versions: sorted.map(toAdminLegalVersion),
    });
  }
  return groups.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}

/** Bir anahtarın etkin şeması: registry varsa o, yoksa DB satırındaki (normalize). İkisi de yoksa null. */
export function resolveSiteContentSchema(entry: SiteContentRegistryEntry | undefined, row: SiteContent | null): ContentSchema | null {
  if (entry) return entry.schema;
  if (row) return normalizeContentSchema(row.schema);
  return null;
}

/** Registry girdisi + DB satırı → admin satırı (satır yoksa value null, updatedAt null). */
export function toAdminSiteContentItem(entry: SiteContentRegistryEntry | undefined, row: SiteContent | null): AdminSiteContentItem {
  return {
    key: entry?.key ?? row?.key ?? '',
    label: entry?.label ?? row?.label ?? '',
    page: entry?.page ?? 'global',
    schema: resolveSiteContentSchema(entry, row) ?? { fields: [] },
    value: row ? row.value : null,
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}
