// F10 güvenlik — CMS zengin metin temizliği (depolanmış XSS). Saf birim testi: DB/HTTP yok.
// Kural: temiz içerik BYTE-BYTE aynı kalmalı (piksel parite), betik taşıyan yapılar düşmeli.
import '../helpers/env';
import { isUnsafeUrl, sanitizeRichHtml } from '../../common/security/html-sanitize';
import { escapeContentValue } from '../../modules/content/site-content.schema';
import { buildLegalArticles, toPostView } from '../../web/content-view';

/** Seed/CMS gövdelerinde fiilen bulunan işaretleme — hiçbiri değişmemeli. */
const CLEAN_SAMPLES = [
  '<p>Bağdam, Urla&#39;dan sofraya seçki kutusu.</p>',
  '<h3>Saklama süreleri</h3><ul><li>Sipariş verisi: 120 ay</li><li>E-posta günlüğü: 90 gün</li></ul>',
  '<p>Ayrıntı için <a href="mailto:merhaba@bagdam.com">yazın</a> ya da <a href="/politikalar.html#kvkk">KVKK metnine</a> bakın.</p>',
  '<p><em>Söyleşi</em> &amp; <strong>üretici</strong> notları — 5 dk</p>',
  '<img src="assets/images/urla.webp" alt="Urla" loading="lazy">',
  '<p>Fiyat 1 &lt; 2 ve 3 &gt; 2; oran %10 "indirim".</p>',
  '<blockquote cite="https://bagdam.com/gunluk.html"><p>Toprağın takvimi bizimkinden yavaş.</p></blockquote>',
  '<table><tr><td style="text-align:right">1.000,00 TL</td></tr></table>',
  '<div class="policy-body"><p>Madde 1</p><br><p>Madde 2</p></div>',
  'Düz metin, etiket yok.',
  '',
];

describe('sanitizeRichHtml — CMS zengin metin (F10)', () => {
  it('temiz içeriği HİÇ değiştirmez (parite garantisi)', () => {
    for (const s of CLEAN_SAMPLES) expect(sanitizeRichHtml(s)).toBe(s);
  });

  it('idempotent: f(f(x)) === f(x)', () => {
    const dirty = '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(2)">b</a>';
    const once = sanitizeRichHtml(dirty);
    expect(sanitizeRichHtml(once)).toBe(once);
  });

  it('<script> gövdesiyle birlikte silinir (kapanışsız hâli dahil)', () => {
    expect(sanitizeRichHtml('<p>a</p><script>alert(1)</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(sanitizeRichHtml('<p>a</p><SCRIPT type="text/javascript">alert(1)</SCRIPT>')).toBe('<p>a</p>');
    expect(sanitizeRichHtml('<p>a</p><script>alert(1)')).toBe('<p>a</p>');
    expect(sanitizeRichHtml('<p>a</p></script><p>b</p>')).toBe('<p>a</p><p>b</p>');
  });

  it('iframe / object / embed / base / link / meta düşer', () => {
    expect(sanitizeRichHtml('<p>a</p><iframe src="https://evil.example"></iframe>')).toBe('<p>a</p>');
    expect(sanitizeRichHtml('<object data="x.swf"><param name="a"></object><p>b</p>')).toBe('<p>b</p>');
    expect(sanitizeRichHtml('<embed src="x.swf"><p>b</p>')).toBe('<p>b</p>');
    expect(sanitizeRichHtml('<base href="https://evil.example/"><p>b</p>')).toBe('<p>b</p>');
    expect(sanitizeRichHtml('<link rel="stylesheet" href="https://evil.example/x.css"><p>b</p>')).toBe('<p>b</p>');
    expect(sanitizeRichHtml('<meta http-equiv="refresh" content="0;url=https://evil.example"><p>b</p>')).toBe('<p>b</p>');
  });

  it('on… olay nitelikleri düşer, etiketin kendisi ve diğer nitelikleri kalır', () => {
    expect(sanitizeRichHtml('<p class="x" onclick="alert(1)">a</p>')).toBe('<p class="x">a</p>');
    expect(sanitizeRichHtml('<img src="a.webp" onerror=alert(1) alt="a">')).toBe('<img src="a.webp" alt="a">');
    expect(sanitizeRichHtml(`<div ONLOAD='alert(1)'>a</div>`)).toBe('<div>a</div>');
    expect(sanitizeRichHtml('<svg><animate onbegin="alert(1)"></animate></svg>')).toBe('<svg><animate></animate></svg>');
  });

  it('srcdoc / formaction / xlink:href koşulsuz düşer', () => {
    expect(sanitizeRichHtml('<div srcdoc="<script>alert(1)</script>">a</div>')).toBe('<div>a</div>');
    expect(sanitizeRichHtml('<button formaction="javascript:alert(1)">a</button>')).toBe('<button>a</button>');
    expect(sanitizeRichHtml('<svg><a xlink:href="javascript:alert(1)">a</a></svg>')).toBe('<svg><a>a</a></svg>');
  });

  it('javascript:/vbscript:/data:text-html bağlantıları "#" olur; meşru şemalar kalır', () => {
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">a</a>')).toBe('<a href="#">a</a>');
    expect(sanitizeRichHtml('<a href="JaVaScRiPt:alert(1)">a</a>')).toBe('<a href="#">a</a>');
    expect(sanitizeRichHtml('<a href="java&#115;cript:alert(1)">a</a>')).toBe('<a href="#">a</a>');
    expect(sanitizeRichHtml('<a href="vbscript:msgbox(1)">a</a>')).toBe('<a href="#">a</a>');
    expect(sanitizeRichHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">a</a>')).toBe('<a href="#">a</a>');
    // meşru
    const ok = '<a href="https://bagdam.com">a</a><a href="/urunler.html">b</a><a href="mailto:x@y.z">c</a><a href="tel:+902321112233">d</a>';
    expect(sanitizeRichHtml(ok)).toBe(ok);
    const dataImg = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="">';
    expect(sanitizeRichHtml(dataImg)).toBe(dataImg);
  });

  it('isUnsafeUrl: boşluk/kontrol karakteri kaçamakları yakalanır', () => {
    expect(isUnsafeUrl('javascript:alert(1)')).toBe(true);
    expect(isUnsafeUrl(' java\tscript:alert(1)')).toBe(true);
    expect(isUnsafeUrl('java&#9;script:alert(1)')).toBe(true);
    expect(isUnsafeUrl('https://bagdam.com')).toBe(false);
    expect(isUnsafeUrl('assets/images/a.webp')).toBe(false);
    expect(isUnsafeUrl('data:image/webp;base64,AAA')).toBe(false);
  });

  it('tırnak içindeki ">" etiketi erken bitirmez', () => {
    const s = '<a title="1 > 0" href="/x.html">a</a>';
    expect(sanitizeRichHtml(s)).toBe(s);
    expect(sanitizeRichHtml('<a title="1 > 0" onclick="alert(1)" href="/x.html">a</a>')).toBe('<a title="1 > 0" href="/x.html">a</a>');
  });

  it('büyük gövdede makul sürede biter (geri izleme patlaması yok)', () => {
    const big = '<p class="policy">Madde &amp; fıkra "metni" 1 &lt; 2</p>'.repeat(2000);
    const t0 = Date.now();
    expect(sanitizeRichHtml(big)).toBe(big);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('temizlik render yolunda uygulanır (F10)', () => {
  const dirty = '<p>Metin</p><script>document.cookie</script>';

  it('SiteContent richtext alanı (escapeContentValue)', () => {
    const schema = { fields: [{ name: 'bodyHtml', label: 'Gövde', type: 'richtext' as const }] };
    expect(escapeContentValue(schema, { bodyHtml: dirty })).toEqual({ bodyHtml: '<p>Metin</p>' });
  });

  it('LegalDocument gövdesi (politikalar.hbs {{{bodyHtml}}})', () => {
    const [art] = buildLegalArticles([
      {
        slug: 'kvkk',
        kind: 'KVKK',
        title: 'KVKK',
        version: 1,
        leadHtml: '<p onclick="x()">giriş</p>',
        bodyHtml: dirty,
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        requiresAck: false,
        showInNav: true,
        sortOrder: 1,
      },
    ]);
    expect(art!.bodyHtml).toBe('<p>Metin</p>');
    expect(art!.leadHtml).toBe('<p>giriş</p>');
  });

  it('Post gövdesi/başlığı (gunluk.hbs)', () => {
    const v = toPostView({
      slug: 'x',
      kind: 'Söyleşi',
      readMinutes: 5,
      titleHtml: '<em>Başlık</em><script>alert(1)</script>',
      bodyHtml: dirty,
      publishedAt: new Date('2026-08-16T09:00:00.000Z'),
      coverPath: null,
      coverAlt: null,
    });
    expect(v.titleHtml).toBe('<em>Başlık</em>');
    expect(v.bodyHtml).toBe('<p>Metin</p>');
  });
});
