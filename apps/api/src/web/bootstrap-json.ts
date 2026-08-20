import type { BootstrapPayload } from '@bagdam/shared';

// Kaçış dizileri karakter kodlarıyla kurulur (kaynakta ters bölü / görünmez U+2028 yazmamak için):
// BACKSLASH = "\", LS = U+2028 (LINE SEPARATOR), PS = U+2029 (PARAGRAPH SEPARATOR).
const BACKSLASH = String.fromCharCode(0x5c);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/** Script içinde ham bırakılamayacak karakterler: `<` (script kapanışı) + U+2028/U+2029 (JS satır sonu). */
const UNSAFE_IN_SCRIPT = new RegExp(`[<${LS}${PS}]`, 'g');
const ESCAPES: Record<string, string> = {
  '<': `${BACKSLASH}u003c`,
  [LS]: `${BACKSLASH}u2028`,
  [PS]: `${BACKSLASH}u2029`,
};

/**
 * `{{> bootstrap}}` partial'ına gömülecek JSON metni (ADR-0003, BACKEND-PLANI §1.2).
 * `<script>` içine ham basıldığı için (`{{{bootstrapJson}}}`):
 * - `<` → `\u003c` : `</script>` / `<!--` ile script bloğunun kapanmasını engeller (XSS / parse güvenliği);
 * - U+2028 / U+2029 → `\u2028` / `\u2029` : JSON'da geçerli ama JS kaynakta satır sonu sayılabilir.
 * JSON.stringify `"` ve ters bölüyü zaten kaçışlar; `undefined` alanlar (boxAmount/images/season/tab)
 * çıktıya hiç yazılmaz — products.js şekliyle alan-alan parite [B6].
 */
export function toBootstrapJson(payload: BootstrapPayload): string {
  return toScriptJson(payload);
}

/**
 * Herhangi bir değeri `<script>` içine ham gömülebilecek JSON metnine çevirir (aynı kaçış kuralı).
 * F5: toptan.hbs form metinleri (`{{{toptanTextsJson}}}`) gibi küçük JSON parçaları için.
 */
export function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE_IN_SCRIPT, (ch) => ESCAPES[ch] ?? ch);
}
