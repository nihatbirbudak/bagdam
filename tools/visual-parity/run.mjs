// tools/visual-parity/run.mjs — F3 görsel parite + sepet duman testi (ADR-0003 / BACKEND-PLANI §1.2)
//
// Eski statik site (website/, :8080) ile yeni Nest render'ı (:4023 geçici ya da :4010) arasında
// 10 sayfa × 3 viewport tam sayfa ekran görüntüsü alır, pixelmatch ile karşılaştırır ve
// `report.md` yazar. Ardından her iki sitede aynı sepet/kutu etkileşimini yürütüp DOM sonucunu kıyaslar.
//
// Kullanım (repo kökünden):
//   node tools/visual-parity/run.mjs [--old=http://127.0.0.1:8080] [--new=http://127.0.0.1:4023]
//        [--threshold=0.1] [--max-diff-pct=0.1] [--only=kutu,urun] [--skip-visual] [--skip-smoke] [--smoke-product=ekmek]
// Bağımlılıklar kökte kurulu: @playwright/test (Chromium), pixelmatch, pngjs. Çıktılar: out/ (gitignore), report.md.
// Çıkış kodu: görsel eşik aşımı ya da duman testi farkı varsa 1.
import { chromium } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'out');
const REPORT_PATH = join(HERE, 'report.md');

// ---- argümanlar ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const OLD_BASE = String(args.old || process.env.PARITY_OLD || 'http://127.0.0.1:8080').replace(/\/$/, '');
const NEW_BASE = String(args.new || process.env.PARITY_NEW || 'http://127.0.0.1:4023').replace(/\/$/, '');
const PIXEL_THRESHOLD = Number(args.threshold ?? 0.1); // pixelmatch renk eşiği (0..1)
const MAX_DIFF_PCT = Number(args['max-diff-pct'] ?? 0.1); // kabul: fark piksel oranı ≤ %0.1
const ONLY = args.only ? String(args.only).split(',') : null;
const SKIP_VISUAL = Boolean(args['skip-visual']);
const SKIP_SMOKE = Boolean(args['skip-smoke']);
// incir fresh → ürün sayfasında "kutuda dene" CTA'sı var, sepete ekle düğmesi yok; ekleme için pantry ürünü.
const SMOKE_ADD_PRODUCT = String(args['smoke-product'] || 'ekmek');

// ---- sayfalar / viewport'lar -----------------------------------------------------------------
// kutu.html abone tier'ı yoksa urunler.html'e yönlendirir → ?tier=sezon ile açılır (iki sitede de aynı).
const PAGES = [
  { name: 'index', path: '/index.html' },
  { name: 'urunler', path: '/urunler.html' },
  { name: 'urun', path: '/urun.html' },
  { name: 'kutu', path: '/kutu.html?tier=sezon' },
  { name: 'sepet', path: '/sepet.html' },
  { name: 'uyelik', path: '/uyelik.html' },
  { name: 'gunluk', path: '/gunluk.html' },
  { name: 'toptan', path: '/toptan.html' },
  { name: 'politikalar', path: '/politikalar.html' },
  { name: 'nasil-seciyoruz', path: '/nasil-seciyoruz.html' },
];
const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-820', width: 820, height: 1180 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

// Tek sabit "şimdi": iki sitede kesim/geri sayım metinleri aynı olsun (cart.js new Date()/Date.now()).
const FIXED_NOW = Date.now();
const FREEZE_DATE_SCRIPT = `(() => {
  const fixed = ${FIXED_NOW};
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...a) { if (a.length === 0) { super(fixed); } else { super(...a); } }
    static now() { return fixed; }
  }
  FrozenDate.UTC = RealDate.UTC; FrozenDate.parse = RealDate.parse;
  window.Date = FrozenDate;
})();`;

// Animasyon/geçiş/caret kapalı — iki tarafa da aynı uygulanır (reducedMotion emülasyonuna ek).
const NO_MOTION_CSS =
  '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;' +
  'transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}';

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript(FREEZE_DATE_SCRIPT);
  const page = await ctx.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return { ctx, page };
}

/** Sayfayı yükler, fontlar + görseller hazır olana kadar bekler, lazy içerik için sona kadar kaydırıp başa döner. */
async function settle(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.addStyleTag({ content: NO_MOTION_CSS });
  await page.evaluate(() => document.fonts.ready);
  // Lazy görseller / IntersectionObserver açığa çıkarma: adım adım aşağı, sonra en üste.
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const total = () => document.documentElement.scrollHeight;
    for (let y = 0; y < total(); y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, total());
    await new Promise((r) => setTimeout(r, 120));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 120));
  });
  // Görünür alandaki görsellerin yüklenmesini bekle; ekran dışı `loading="lazy"` görseller hiç yüklenmeyebilir
  // (iki sitede de aynı şekilde boş kalır) → onları bekleme, ayrıca 3 s üst sınır (takılma yok).
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete && img.loading !== 'lazy')
          .map((img) => new Promise((r) => { img.onload = img.onerror = r; })),
      ),
      new Promise((r) => setTimeout(r, 3000)),
    ]),
  );
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

/** Üst sınır: tek bir ekran görüntüsü adımı en fazla `ms` sürer; aşarsa satır HATA olur, koşu sürer. */
function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: ${ms} ms zaman aşımı`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function shoot(browser, base, pageDef, viewport, tag) {
  const { ctx, page } = await newPage(browser, viewport);
  try {
    await withTimeout(settle(page, base + pageDef.path), 90_000, `${tag} ${pageDef.name} ${viewport.name}`);
    const file = join(OUT_DIR, `${pageDef.name}--${viewport.name}--${tag}.png`);
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
    return file;
  } finally {
    await ctx.close();
  }
}

/** Boyutlar farklıysa küçük olan beyaz zeminle büyük tuvale oturtulur; fark oranı büyük tuvale göredir. */
function comparePng(oldFile, newFile, diffFile) {
  const a = PNG.sync.read(readFileSync(oldFile));
  const b = PNG.sync.read(readFileSync(newFile));
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const fit = (img) => {
    if (img.width === width && img.height === height) return img;
    const out = new PNG({ width, height });
    out.data.fill(255);
    PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
    return out;
  };
  const A = fit(a);
  const B = fit(b);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(A.data, B.data, diff.data, width, height, { threshold: PIXEL_THRESHOLD, includeAA: false });
  writeFileSync(diffFile, PNG.sync.write(diff));
  return {
    diffPixels,
    totalPixels: width * height,
    diffPct: (diffPixels / (width * height)) * 100,
    oldSize: `${a.width}×${a.height}`,
    newSize: `${b.width}×${b.height}`,
    sizeEqual: a.width === b.width && a.height === b.height,
  };
}

// ---- duman testi ----------------------------------------------------------------------------
// Her iki sitede aynı adımlar (temiz context) → aynı DOM/localStorage sonucu beklenir.
async function smoke(browser, base) {
  const { ctx, page } = await newPage(browser, VIEWPORTS[2]);
  const r = { base };
  const text = async (sel) => (await page.locator(sel).first().textContent().catch(() => null))?.trim() ?? null;
  try {
    // 1) urun.html?id=incir — fresh ürün: CTA metni + data-add-to-cart yuva sayısı
    await page.goto(base + '/urun.html?id=incir', { waitUntil: 'networkidle' });
    r.incirTitle = await text('.pd-tab-main h1');
    r.incirCta = await text('.pd-price-row .cta');
    r.incirAddSlots = await page.locator('.pd-price-row [data-add-to-cart]').count();
    r.hasBootstrap = await page.evaluate(() => typeof window.__BAGDAM__ !== 'undefined');

    // 2) tekil ürün sayfası: "+" (Sepete ekle) → stepper 1, kayan sepet sayacı 1, localStorage bahceden_cart 1 öğe
    await page.goto(`${base}/urun.html?id=${SMOKE_ADD_PRODUCT}`, { waitUntil: 'networkidle' });
    const addBtn = page.locator('.pd-price-row [data-add-to-cart] .qty-stepper-add').first();
    await addBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await addBtn.click();
    const pop = page.locator('.pref-pop .toggle').first();
    if (await pop.isVisible().catch(() => false)) await pop.click();
    const countEl = page.locator('.pd-price-row [data-add-to-cart] .qty-stepper-count').first();
    await countEl.waitFor({ state: 'visible', timeout: 10_000 });
    r.stepperCount = (await countEl.textContent())?.trim();
    r.floatingCount = await text('.floating-cart-count');
    r.cart = await page.evaluate(() => JSON.parse(localStorage.getItem('bahceden_cart') || '[]'));

    // 3) kutu.html?tier=sezon — şablon (templates.sezon) ürünleri görünür
    await page.goto(base + '/kutu.html?tier=sezon', { waitUntil: 'networkidle' });
    await page.locator('#boxItems .box-item').first().waitFor({ state: 'visible', timeout: 10_000 });
    r.kutuUrl = page.url().replace(base, '');
    r.tierTitle = await text('#tierTitle');
    r.tierPrice = await text('#tierPrice');
    r.boxItems = (await page.locator('#boxItems .box-item h3').allTextContents()).map((s) => s.trim());
    r.boxItemCount = r.boxItems.length;
    r.subItems = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('bahceden_sub') || 'null');
      return s ? s.items : null;
    });
    r.templateSezon = await page.evaluate(
      () => (window.__BAGDAM__ && window.__BAGDAM__.templates && window.__BAGDAM__.templates.sezon) || null,
    );
    r.floatingCountOnKutu = await text('.floating-cart-count');
  } catch (e) {
    r.error = e.message;
  } finally {
    await ctx.close();
  }
  return r;
}

// ---- çalıştır -------------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const startedAt = new Date();
const visualRows = [];
let visualFail = 0;

if (!SKIP_VISUAL) {
  for (const pageDef of PAGES) {
    if (ONLY && !ONLY.includes(pageDef.name)) continue;
    for (const vp of VIEWPORTS) {
      const t0 = Date.now();
      let row = { page: pageDef.name, path: pageDef.path, viewport: vp.name };
      try {
        const oldFile = await shoot(browser, OLD_BASE, pageDef, vp, 'old');
        const newFile = await shoot(browser, NEW_BASE, pageDef, vp, 'new');
        const diffFile = join(OUT_DIR, `${pageDef.name}--${vp.name}--diff.png`);
        const res = comparePng(oldFile, newFile, diffFile);
        row = { ...row, ...res, ok: res.diffPct <= MAX_DIFF_PCT, ms: Date.now() - t0 };
      } catch (e) {
        row = { ...row, error: e.message, ok: false, ms: Date.now() - t0 };
      }
      if (!row.ok) visualFail++;
      visualRows.push(row);
      console.log(
        `[visual] ${pageDef.name.padEnd(16)} ${vp.name.padEnd(13)} ` +
          (row.error
            ? `ERROR ${row.error}`
            : `${row.oldSize} vs ${row.newSize}  diff ${row.diffPixels} px (${row.diffPct.toFixed(4)}%)  ${row.ok ? 'OK' : 'FAIL'}`),
      );
    }
  }
}

let smokeOld = null;
let smokeNew = null;
const smokeChecks = [];
if (!SKIP_SMOKE) {
  smokeOld = await smoke(browser, OLD_BASE);
  smokeNew = await smoke(browser, NEW_BASE);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const check = (label, a, b, expectNew) => {
    const same = eq(a, b);
    const expected = expectNew === undefined ? true : eq(b, expectNew);
    smokeChecks.push({ label, old: JSON.stringify(a), new: JSON.stringify(b), same, expected, ok: same && expected });
  };
  check('urun?id=incir: CTA metni (fresh → "kutuda dene")', smokeOld.incirCta, smokeNew.incirCta, 'kutuda dene');
  check('urun?id=incir: data-add-to-cart yuva sayısı', smokeOld.incirAddSlots, smokeNew.incirAddSlots, 0);
  check(`urun?id=${SMOKE_ADD_PRODUCT}: stepper sayacı`, smokeOld.stepperCount, smokeNew.stepperCount, '1');
  check(`urun?id=${SMOKE_ADD_PRODUCT}: kayan sepet sayacı`, smokeOld.floatingCount, smokeNew.floatingCount, '1');
  check('localStorage bahceden_cart öğe sayısı', smokeOld.cart?.length, smokeNew.cart?.length, 1);
  check('localStorage bahceden_cart içerik', smokeOld.cart, smokeNew.cart, [{ id: SMOKE_ADD_PRODUCT, qty: 1, pref: null }]);
  check('kutu?tier=sezon: URL (yönlendirme yok)', smokeOld.kutuUrl, smokeNew.kutuUrl, '/kutu.html?tier=sezon');
  check('kutu: tier başlığı', smokeOld.tierTitle, smokeNew.tierTitle);
  check('kutu: tier fiyatı', smokeOld.tierPrice, smokeNew.tierPrice);
  check('kutu: #boxItems ürün sayısı', smokeOld.boxItemCount, smokeNew.boxItemCount, 10);
  check('kutu: #boxItems ürün adları', smokeOld.boxItems, smokeNew.boxItems);
  check('kutu: bahceden_sub.items', smokeOld.subItems, smokeNew.subItems);
  check('kutu: sepet sayacı korunuyor', smokeOld.floatingCountOnKutu, smokeNew.floatingCountOnKutu, '1');
  // Yeni sitede şablon gerçekten bootstrap'tan gelmeli: sub.items ≡ __BAGDAM__.templates.sezon
  const tplOk = Boolean(smokeNew.templateSezon) && eq(smokeNew.templateSezon, smokeNew.subItems);
  smokeChecks.push({
    label: 'yeni: bahceden_sub.items ≡ __BAGDAM__.templates.sezon (eski: bootstrap yok)',
    old: JSON.stringify(smokeOld.hasBootstrap ? 'bootstrap var' : 'bootstrap yok'),
    new: JSON.stringify(smokeNew.templateSezon),
    same: true,
    expected: tplOk,
    ok: tplOk && smokeOld.hasBootstrap === false && smokeNew.hasBootstrap === true,
  });
  if (smokeOld.error) smokeChecks.push({ label: 'eski site hata', old: smokeOld.error, new: '', same: false, expected: false, ok: false });
  if (smokeNew.error) smokeChecks.push({ label: 'yeni site hata', old: '', new: smokeNew.error, same: false, expected: false, ok: false });
  for (const c of smokeChecks) console.log(`[smoke] ${c.ok ? 'OK  ' : 'FAIL'} ${c.label}: old=${c.old} new=${c.new}`);
}

await browser.close();

// ---- rapor ----------------------------------------------------------------------------------
const smokeFail = smokeChecks.filter((c) => !c.ok).length;
const lines = [];
lines.push('# Görsel parite raporu — F3 (eski statik site vs Nest render)');
lines.push('');
lines.push(`- Tarih: ${startedAt.toISOString()} · Sabit sayfa saati (Date.now): ${new Date(FIXED_NOW).toISOString()}`);
lines.push(`- Eski: \`${OLD_BASE}\` · Yeni: \`${NEW_BASE}\``);
lines.push(
  `- Araç: Playwright Chromium (headless, DSF 1, reducedMotion: reduce, animasyon/geçiş CSS ile kapalı, ` +
    `\`document.fonts.ready\` + networkidle + sona kadar kaydırma) · pixelmatch threshold ${PIXEL_THRESHOLD}, includeAA false`,
);
lines.push(`- Kabul: fark piksel oranı ≤ %${MAX_DIFF_PCT} (tam sayfa; boyut farkında küçük görüntü beyaz zeminle büyütülür)`);
lines.push('- Çıktılar: `tools/visual-parity/out/<sayfa>--<viewport>--{old,new,diff}.png` (gitignore)');
lines.push('');
if (!SKIP_VISUAL) {
  lines.push(`## Görsel karşılaştırma — ${visualRows.length} çift, ${visualRows.length - visualFail} OK / ${visualFail} FAIL`);
  lines.push('');
  lines.push('| Sayfa | Yol | Viewport | Eski boyut | Yeni boyut | Fark px | Fark % | Sonuç |');
  lines.push('|---|---|---|---|---|---:|---:|---|');
  for (const r of visualRows) {
    lines.push(
      r.error
        ? `| ${r.page} | \`${r.path}\` | ${r.viewport} | — | — | — | — | HATA: ${r.error.replace(/\|/g, '/').slice(0, 120)} |`
        : `| ${r.page} | \`${r.path}\` | ${r.viewport} | ${r.oldSize} | ${r.newSize} | ${r.diffPixels} | ${r.diffPct.toFixed(4)} | ${r.ok ? 'OK' : 'FAIL'} |`,
    );
  }
  lines.push('');
}
if (!SKIP_SMOKE) {
  lines.push(`## Sepet / kutu duman testi — ${smokeChecks.length - smokeFail} OK / ${smokeFail} FAIL`);
  lines.push('');
  lines.push(
    `Adımlar (her iki sitede, temiz context): \`urun.html?id=incir\` (fresh → "kutuda dene", sepete ekle yok) → ` +
      `\`urun.html?id=${SMOKE_ADD_PRODUCT}\` "+" → stepper / kayan sepet / localStorage → \`kutu.html?tier=sezon\` → #boxItems.`,
  );
  lines.push('');
  lines.push('| Kontrol | Eski | Yeni | Aynı | Beklenen | Sonuç |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of smokeChecks) {
    const cut = (s) => String(s).replace(/\|/g, '/').slice(0, 90);
    lines.push(
      `| ${c.label} | \`${cut(c.old)}\` | \`${cut(c.new)}\` | ${c.same ? 'evet' : 'HAYIR'} | ${c.expected ? 'evet' : 'HAYIR'} | ${c.ok ? 'OK' : 'FAIL'} |`,
    );
  }
  lines.push('');
}
writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
console.log(`\nRapor: ${REPORT_PATH}  (visual FAIL: ${visualFail}, smoke FAIL: ${smokeFail})`);
process.exit(visualFail + smokeFail > 0 ? 1 : 0);
