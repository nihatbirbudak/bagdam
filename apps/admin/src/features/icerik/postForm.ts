/**
 * Günlük (Post) formu taslağı: varsayılan · API → taslak · taslak → gövde · doğrulama (saf fonksiyonlar, test edilir).
 * Doğrulama sunucudakinin (ValidationPipe) hafif kopyasıdır; nihai karar API'de.
 */
import type { AdminPost, AdminPostInput, ContentStatusValue } from '../../lib/apiTypes';
import { slugify } from '../../lib/utils';

export interface PostDraft {
  slug: string;
  slugTouched: boolean;
  /** Kart rozeti: "söyleşi" · "mevsim" · "not" … (gunluk.html journal-post-meta). */
  kind: string;
  readMinutes: string;
  titleHtml: string;
  excerpt: string;
  bodyHtml: string;
  coverMediaId: string | null;
  coverUrl: string | null;
  /** Virgül / satır ile ayrılmış slug listesi. */
  relatedSlugsText: string;
  status: ContentStatusValue;
}

export type PostDraftErrors = Partial<Record<keyof PostDraft, string>>;

/** gunluk.html'deki rozetler + yaygın türler (serbest metin; öneri listesi). */
export const POST_KIND_SUGGESTIONS = ['söyleşi', 'mevsim', 'not', 'tarif', 'üretici', 'duyuru'];

/** API POST_SLUG_RE ile aynı: küçük harf/rakam ile başlar; küçük harf, rakam, tire; 1–120. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export function emptyPostDraft(): PostDraft {
  return {
    slug: '',
    slugTouched: false,
    kind: 'not',
    readMinutes: '4',
    titleHtml: '',
    excerpt: '',
    bodyHtml: '',
    coverMediaId: null,
    coverUrl: null,
    relatedSlugsText: '',
    status: 'DRAFT',
  };
}

export function postToDraft(p: AdminPost): PostDraft {
  return {
    slug: p.slug ?? '',
    slugTouched: true,
    kind: p.kind ?? '',
    readMinutes: String(p.readMinutes ?? 4),
    titleHtml: p.titleHtml ?? '',
    excerpt: p.excerpt ?? '',
    bodyHtml: p.bodyHtml ?? '',
    coverMediaId: p.coverMediaId ?? null,
    coverUrl: p.coverUrl ?? null,
    relatedSlugsText: (p.relatedSlugs ?? []).join(', '),
    status: p.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
  };
}

/** Virgül/satır/noktalı virgül ile ayrılmış slug listesi; boşlar atılır, tekrarlar tekil. */
export function parseRelatedSlugs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const s = raw.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Başlık HTML'inden (`<em>`) düz metin — tablo/kırıntı için. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function validatePostDraft(d: PostDraft): PostDraftErrors {
  const e: PostDraftErrors = {};
  if (!d.slug.trim()) e.slug = 'Slug zorunlu';
  else if (!SLUG_RE.test(d.slug.trim())) e.slug = 'Yalnız küçük harf, rakam ve tire; en fazla 120 karakter (ör. cavdar-ekmegi)';
  if (!d.kind.trim()) e.kind = 'Tür zorunlu (ör. söyleşi, mevsim, not)';
  else if (d.kind.trim().length > 30) e.kind = 'En fazla 30 karakter';
  const rm = d.readMinutes.trim();
  if (!/^\d+$/.test(rm) || Number(rm) < 1 || Number(rm) > 180) e.readMinutes = 'Okuma süresi 1–180 arası tam sayı (dk)';
  if (!stripHtml(d.titleHtml).trim()) e.titleHtml = 'Başlık zorunlu';
  if (!stripHtml(d.bodyHtml).trim()) e.bodyHtml = 'Gövde zorunlu';
  const related = parseRelatedSlugs(d.relatedSlugsText);
  if (related.some((s) => !SLUG_RE.test(s))) e.relatedSlugsText = 'İlgili yazı slug’ları yalnız küçük harf, rakam ve tire içerebilir';
  if (d.slug.trim() && related.includes(d.slug.trim())) e.relatedSlugsText = 'Yazı kendisini ilgili yazı olarak gösteremez';
  return e;
}

export function toPostBody(d: PostDraft): AdminPostInput {
  return {
    slug: d.slug.trim(),
    kind: d.kind.trim(),
    readMinutes: Number(d.readMinutes.trim()) || 4,
    titleHtml: d.titleHtml.trim(),
    excerpt: d.excerpt.trim() || null,
    bodyHtml: d.bodyHtml,
    coverMediaId: d.coverMediaId || null,
    relatedSlugs: parseRelatedSlugs(d.relatedSlugsText),
    status: d.status,
  };
}

/** Başlık yazılırken slug'ı türetir (kullanıcı slug'ı elle değiştirmediyse). */
export function suggestPostSlug(titleHtml: string): string {
  return slugify(stripHtml(titleHtml)).slice(0, 120);
}
