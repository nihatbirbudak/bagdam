// Ekran görüntülerini küçültüp tek HTML galeriye gömer
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
// sharp yalnız apps/api bağımlılığı — oradan çöz
const requireFromApi = createRequire(path.resolve(process.cwd(), "apps/api/package.json"));
const sharp = requireFromApi("sharp");

const SHOTS = process.argv[2];
const OUT = process.argv[3];
const FONTS = process.argv[4]; // fonts.css yolu (gömülü woff2)

const SITE = [
  ["01-anasayfa", "Ana sayfa", "Hero, dört sütun (mevsiminde/şeffaf/seçilmiş/garantili), öne çıkanlar, son yazılar, toptan bloğu — hepsi veritabanından."],
  ["02-urunler", "Tüm ürünler", "Kategori sekmeleri (taze kutular / süt ürünleri / fırın / kiler) ve ürün kartları."],
  ["03-urun-detay", "Ürün detayı", "Parti kodu, 'neden bu ürünü seçtik', saklama/alerjen metinleri, tercih seçimi."],
  ["04-kutu", "Kutu kur", "Tier seçimi, haftanın kutusu şablonu, ürün değiştirme, ekstralar, frekans ve teslimat günü."],
  ["05-sepet", "Sepet & ödeme", "Adım adım checkout: giriş → adres → teslimat günü → yasal onaylar → kupon → ödeme (PayTR)."],
  ["06-uyelik", "Üyelik / hesabım", "Giriş & üye ol, aboneliğim, siparişlerim, adres ve kart yönetimi."],
  ["07-gunluk", "Günlük", "Üretici ve mevsim yazıları — admin panelden yönetiliyor."],
  ["08-toptan", "Toptan", "Restoran/işletme talep formu — kayıtlar panele düşüyor."],
  ["09-politikalar", "Politikalar", "11 yasal metin, sürümlü; nav'da 8 tanesi görünür."],
  ["10-nasil-seciyoruz", "Nasıl seçiyoruz", "Manifesto ve seçim süreci."],
];
const MOBILE = [
  ["m-01-anasayfa", "Ana sayfa"],
  ["m-02-urunler", "Tüm ürünler"],
  ["m-03-urun-detay", "Ürün detayı"],
  ["m-04-kutu", "Kutu kur"],
];
const ADMIN = [
  ["a0-giris", "Giriş", "E-posta + parola; 5 hatalı denemede 30 dakika kilit."],
  ["a1-ozet", "Özet", "Bugünkü/haftalık sipariş ve ciro, abonelikler, ödeme problemleri, bu haftanın kesim durumu."],
  ["a2-urunler", "Ürünler", "Liste + filtre; ürün formunda partiler, görseller, tercihler, kutu ayarları."],
  ["a3-haftanin-kutusu", "Haftanın kutusu", "Hafta seçici, havuzdan ürün ekleme, yayınlama, gelecek haftaya kopyalama."],
  ["a4-siparisler", "Siparişler", "Durum geçişleri, iade, CSV dışa aktarma, fatura alanları."],
  ["a5-abonelikler", "Abonelikler", "Cycle geçmişi, olay günlüğü, iptal kayıtları, telafi."],
  ["a6-teslimat-gunu", "Teslimat günü", "Toplama listesi, paketleme fişi, yazdırma, toplu durum değişimi."],
  ["a7-icerik", "İçerik", "Site blokları, günlük yazıları, yasal metinler — sürümlü."],
  ["a8-ayarlar", "Ayarlar", "Kampanya kuralları, bölgeler, e-posta, PayTR, çerez, gizlilik."],
  ["a9-sistem", "Sistem", "Denetim, sistem, cron, e-posta ve webhook kayıtları."],
  ["a10-medya", "Medya", "85 görsel; yükleme webp'ye çevirir, küçük resim üretir."],
];

async function embed(name, maxW) {
  const p = path.join(SHOTS, name + ".png");
  if (!fs.existsSync(p)) return null;
  const buf = await sharp(p).resize({ width: maxW, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  return "data:image/webp;base64," + buf.toString("base64");
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function section(items, maxW, kind) {
  const out = [];
  for (const [file, title, desc] of items) {
    const uri = await embed(file, maxW);
    if (!uri) continue;
    out.push(`<figure class="shot ${kind}">
  <div class="frame"><img src="${uri}" alt="${esc(title)}" loading="lazy"></div>
  <figcaption><h3>${esc(title)}</h3>${desc ? `<p>${esc(desc)}</p>` : ""}</figcaption>
</figure>`);
    console.log("gömüldü:", file, Math.round(uri.length / 1024) + "KB");
  }
  return out.join("\n");
}

const fonts = fs.readFileSync(FONTS, "utf8");
const siteHtml = await section(SITE, 900, "desk");
const mobHtml = await section(MOBILE, 390, "mob");
const admHtml = await section(ADMIN, 900, "desk");

const html = `<title>Bağdam Ekran Turu</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${fonts}
:root{
  --bg:#F4F0E6; --surface:#FBF8F0; --surface-deep:#E8DEC5;
  --ink:#292922; --ink-soft:#5B594C; --ink-mute:#8A877A;
  --line:rgba(41,41,34,.16); --line-strong:rgba(41,41,34,.32);
  --tomato:#E85B2A; --tomato-deep:#B4441E; --olive:#68704A; --olive-deep:#4B5136;
  --butter-deep:#8A6A1E; --fig:#805064;
  --shadow:0 1px 0 rgba(41,41,34,.06), 0 18px 40px -28px rgba(41,41,34,.5);
  --sans:"Switzer",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --serif:"Sentient",Georgia,serif; --mono:"IBM Plex Mono",ui-monospace,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#1F1F1A; --surface:#27271F; --surface-deep:#3A3829; --ink:#F1ECDF; --ink-soft:#BDB8A6; --ink-mute:#8E8A7B;
  --line:rgba(241,236,223,.16); --line-strong:rgba(241,236,223,.34); --tomato:#F3754A; --tomato-deep:#F7946F;
  --olive:#A5AD7F; --olive-deep:#C4CBA0; --butter-deep:#E9CF7C; --fig:#BC8FA6;
  --shadow:0 1px 0 rgba(0,0,0,.3), 0 18px 40px -28px rgba(0,0,0,.9);
}}
:root[data-theme="dark"]{
  --bg:#1F1F1A; --surface:#27271F; --surface-deep:#3A3829; --ink:#F1ECDF; --ink-soft:#BDB8A6; --ink-mute:#8E8A7B;
  --line:rgba(241,236,223,.16); --line-strong:rgba(241,236,223,.34); --tomato:#F3754A; --tomato-deep:#F7946F;
  --olive:#A5AD7F; --olive-deep:#C4CBA0; --butter-deep:#E9CF7C; --fig:#BC8FA6;
  --shadow:0 1px 0 rgba(0,0,0,.3), 0 18px 40px -28px rgba(0,0,0,.9);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft)}
header.hero{padding:56px 0 30px;border-bottom:1px solid var(--line)}
header.hero h1{font-weight:600;font-size:clamp(32px,4.6vw,52px);line-height:1.04;letter-spacing:-.025em;margin:16px 0 0;max-width:20ch;text-wrap:balance}
header.hero h1 em{font-family:var(--serif);font-style:italic;font-weight:400;color:var(--tomato)}
header.hero p{max-width:62ch;color:var(--ink-soft);font-size:17px;margin:18px 0 0}
.facts{display:flex;flex-wrap:wrap;gap:8px 22px;margin:24px 0 0;padding:0;list-style:none}
.facts li{font-family:var(--mono);font-size:12.5px;color:var(--ink-soft);display:flex;gap:8px;align-items:baseline}
.facts li b{font-size:19px;font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.section-head{display:flex;align-items:baseline;gap:14px;margin:52px 0 20px}
.section-head h2{font-size:23px;font-weight:600;letter-spacing:-.015em;margin:0}
.section-head .eyebrow::before{content:"";display:inline-block;width:18px;height:1px;background:var(--tomato);vertical-align:middle;margin-right:8px}
.grid{display:grid;gap:26px}
.grid.desk{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid.mobs{grid-template-columns:repeat(4,minmax(0,1fr))}
@media (max-width:820px){.grid.desk{grid-template-columns:minmax(0,1fr)}.grid.mobs{grid-template-columns:repeat(2,minmax(0,1fr))}}
.shot{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
.frame{max-height:520px;overflow:hidden;border-bottom:1px solid var(--line);background:var(--surface-deep)}
.shot.mob .frame{max-height:640px}
.frame img{display:block;width:100%;height:auto}
figcaption{padding:14px 16px 16px}
figcaption h3{margin:0;font-size:15.5px;font-weight:600;letter-spacing:-.01em}
figcaption p{margin:6px 0 0;font-size:13.5px;color:var(--ink-soft);line-height:1.45}
.note{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:34px 0 0;font-size:14px;color:var(--ink-soft);box-shadow:var(--shadow)}
.note b{color:var(--ink)}
.note code{font-family:var(--mono);font-size:12.5px;background:var(--surface-deep);padding:.1em .4em;border-radius:4px}
footer{border-top:1px solid var(--line);margin-top:56px;padding:22px 0 60px;font-size:13px;color:var(--ink-soft)}
</style>

<header class="hero"><div class="wrap">
  <div class="eyebrow">Bağdam · lokal çalışan sistem · 21 Ağustos 2026</div>
  <h1>Tasarım aynı; arkasında artık <em>bir sistem var.</em></h1>
  <p>Aşağıdaki ekranlar, bilgisayarında çalışan sürümden alındı. Sayfalar prototiple <b>piksel piksel aynı</b> (30/30 karşılaştırma, 0 piksel fark) — fark şu ki içerik, ürünler, fiyatlar, kutu şablonları ve yasal metinler artık veritabanından geliyor ve admin panelden yönetiliyor.</p>
  <ul class="facts">
    <li><b>10</b> site sayfası</li>
    <li><b>23</b> yönetim ekranı</li>
    <li><b>22</b> ürün · <b>15</b> üretici</li>
    <li><b>740</b> otomatik test</li>
    <li><b>0 px</b> tasarım farkı</li>
  </ul>
</div></header>

<main class="wrap">
  <div class="section-head"><span class="eyebrow">Site</span><h2>Müşterinin gördüğü sayfalar</h2></div>
  <div class="grid desk">
${siteHtml}
  </div>

  <div class="section-head"><span class="eyebrow">Mobil</span><h2>Telefonda</h2></div>
  <div class="grid mobs">
${mobHtml}
  </div>

  <div class="section-head"><span class="eyebrow">Yönetim</span><h2>Admin panel</h2></div>
  <div class="grid desk">
${admHtml}
  </div>

  <div class="note">
    <b>Kendin denemek için</b> — site: <code>http://localhost:4010</code> · panel: <code>http://localhost:4011</code> (e-posta <code>admin@bagdam.com</code>).
    Ödeme şu an <b>test modunda</b>: PayTR mağaza bilgileri girilene kadar sipariş "manuel onay" ile tamamlanıyor, gerçek tahsilat yapılmıyor.
  </div>
</main>

<footer><div class="wrap">Ekran görüntüleri otomatik alındı (Playwright, 1440×900 ve 390×844). Görseller sayfanın tamamını gösterir; kartlarda üst kısım kırpılmıştır.</div></footer>
`;
fs.writeFileSync(OUT, html);
console.log("\ngaleri:", OUT, Math.round(html.length / 1024 / 1024 * 10) / 10 + "MB");
