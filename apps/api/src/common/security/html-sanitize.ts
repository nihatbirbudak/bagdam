/**
 * CMS zengin metin temizliği (F10 — B'nin "CMS richtext SUNUCUDA SANITIZE EDİLMİYOR" açık notu).
 *
 * Sorun: `politikalar.hbs {{{bodyHtml}}}`, günlük gövdeleri ve `richtext` tipli SiteContent alanları
 * sayfaya HAM basılır. Web CSP'sinde `script-src 'unsafe-inline'` zorunlu olduğu için (ADR-0003 inline
 * bootstrap) panelden yazılan `<script>` tarayıcıda ÇALIŞIR → depolanmış XSS. Saldırgan yalnız
 * ADMIN/STAFF olabilir, ama yetki yükseltme (staff → admin oturumunu çalma) mümkün.
 *
 * Yaklaşım: **izin veren değil, reddeden** (deny-list) temizleyici. Amaç mevcut içeriği DEĞİŞTİRMEMEK
 * (piksel parite: seed/CMS gövdelerinde aşağıdaki yapıların hiçbiri yok → çıktı byte-byte aynı), yalnız
 * betik çalıştırabilen yapıları düşürmek. Tam bir HTML ayrıştırıcısı değil, savunma katmanıdır; iki yerde:
 *  1. yazma anında (`ContentAdminService` — kaynak temiz kalsın, panel ne sakladığını görsün),
 *  2. web render yolunda (`web/content-view.ts` — DB'de kalmış eski satırlar ve seed için).
 *
 * Kapsam dışı bilerek: `<style>` / `style="…"` (CSS enjeksiyonu XSS değil, CMS'te meşru kullanımı var),
 * `<form>` (meşru kullanım), sınıf/id adları.
 */

/**
 * Gövdesiyle birlikte tamamen silinen elemanlar (açılış–kapanış arası ne varsa gider; kapanışı yoksa
 * metnin sonuna kadar — tarayıcı da gerisini o elemanın içi sayar). Yalnız **kapanış etiketi olan**
 * elemanlar bu listede olabilir.
 */
const BLOCK_ELEMENTS = ['script', 'iframe', 'object', 'applet', 'frameset'] as const;

/** Yalnız etiketi silinen (kapanışsız/void) elemanlar — gövde kavramı yok. */
const VOID_ELEMENTS = ['base', 'link', 'meta', 'embed', 'frame'] as const;

/** `on…="…"` olay nitelikleri (onclick/onerror/onload…). */
const EVENT_ATTR = /\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi;

/** `srcdoc` (iFrame içine HTML), `formaction`, `xlink:href` (SVG) — koşulsuz düşer. */
const DANGEROUS_ATTR = /\s(?:srcdoc|formaction|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi;

/** URL taşıyan nitelikler — değeri şema kontrolünden geçer. */
const URL_ATTR = /(\s(?:href|src|action|poster|data|cite|background)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/**
 * Etiket eşleyici. Alternatifler ilk karaktere göre AYRIK (`"` · `'` · diğer) → geri izleme patlaması yok;
 * tırnak içindeki `>` doğru atlanır. Kendini kapatan `/` niteliklerin sonunda kalır, aynen geri yazılır.
 */
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/** Boşluk ve kontrol karakterlerini söker (`java&#9;script:` kaçamağı). */
function stripBlanks(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 32 && code !== 127) out += ch;
  }
  return out;
}

/** `javascript:` / `vbscript:` (varlık veya boşlukla kaçamak dahil) ve görsel olmayan `data:`. */
export function isUnsafeUrl(raw: string): boolean {
  const decoded = raw
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Number.parseInt(d, 10)));
  const flat = stripBlanks(decoded).toLowerCase();
  if (/^(javascript|vbscript|livescript|mocha):/.test(flat)) return true;
  // `data:` yalnız görsel için serbest (CSP `img-src 'self' data:`); `data:text/html` betik taşır.
  if (flat.startsWith('data:') && !/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/.test(flat)) return true;
  return false;
}

function stripBlockElement(html: string, tag: string): string {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
  // Kapanışı olmayan açılış: oradan metnin sonuna kadar silinir (tarayıcı da gerisini o elemanın içi sayar).
  const openTail = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i');
  const stray = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  return html.replace(paired, '').replace(openTail, '').replace(stray, '');
}

/** Tek etiketin niteliklerini temizler; hiçbir şey değişmediyse **aynı dizeyi** döndürür. */
function sanitizeTag(whole: string, name: string, attrs: string): string {
  let a = attrs.replace(EVENT_ATTR, '').replace(DANGEROUS_ATTR, '');
  a = a.replace(URL_ATTR, (m: string, lead: string, _all: string, dq?: string, sq?: string, bare?: string) => {
    const value = dq ?? sq ?? bare ?? '';
    return isUnsafeUrl(value) ? `${lead}"#"` : m;
  });
  return a === attrs ? whole : `<${name}${a}>`;
}

/**
 * Zengin metni betik çalıştıramaz hâle getirir. Girdi zaten temizse **byte-byte aynı** dize döner —
 * piksel parite bu garantiye dayanır. Idempotent: `f(f(x)) === f(x)`.
 */
export function sanitizeRichHtml(html: string): string {
  if (!html || !html.includes('<')) return html;
  let out = html;
  for (const tag of BLOCK_ELEMENTS) {
    if (new RegExp(`<\\/?${tag}\\b`, 'i').test(out)) out = stripBlockElement(out, tag);
  }
  for (const tag of VOID_ELEMENTS) {
    if (new RegExp(`<${tag}\\b`, 'i').test(out)) out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }
  return out.replace(TAG_RE, sanitizeTag);
}

/** `null`/`undefined` geçiren sarmalayıcı (LegalDocument.leadHtml gibi opsiyonel alanlar). */
export function sanitizeRichHtmlOrNull<T extends string | null | undefined>(html: T): T {
  return typeof html === 'string' ? (sanitizeRichHtml(html) as T) : html;
}
