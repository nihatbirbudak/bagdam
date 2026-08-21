# Bağdam

**Urla'dan sofraya** — haftalık seçki kutusu aboneliği, tekil ürün satışı ve toptan tedarik için
e-ticaret sistemi. Hazır tasarım korunarak dinamik, veritabanına bağlı ve yönetim panelinden
yönetilebilir hâle getirildi.

| | |
|---|---|
| **Site** | 10 sayfa — Handlebars şablonları, tasarım prototiple piksel piksel aynı |
| **Yönetim paneli** | 23 ekran — katalog, içerik, siparişler, abonelikler, operasyon, ayarlar |
| **API** | NestJS 11 · Prisma 6 · PostgreSQL · `/api/v1` (site, panel ve ileride mobil aynı API'yi kullanır) |
| **Ödeme** | PayTR (iFrame, bildirim doğrulama, ödeme linki, kayıtlı kart, iade) + kupon |
| **Testler** | API 395 · panel 228 · ortak 117 · uçtan uca senaryolar · tasarım karşılaştırması 30/30 |

---

## Hızlı başlangıç

```bash
git clone https://github.com/nihatbirbudak/bagdam.git
cd bagdam
node tools/setup-local.mjs --su-pass=POSTGRES_PAROLANIZ
pnpm dev:api      # → http://localhost:4010   (site + API)
pnpm dev:admin    # → http://localhost:4011   (yönetim paneli)
```

Ayrıntılı kurulum, test turu ve sorun giderme: **[docs/TEST-REHBERI.md](docs/TEST-REHBERI.md)**
Ekran görüntüleriyle tanıtım: **[docs/ekran-turu.html](docs/ekran-turu.html)** (tarayıcıda açın)

---

## Yapı

```
apps/api        NestJS — API + site şablonları (views/*.hbs) + statik varlıklar
apps/admin      React + Vite — yönetim paneli
packages/shared enum'lar, DTO tipleri, durum makineleri, fiyat hesabı (api + panel ortak)
database        Prisma şeması, migration'lar, örnek veri
website         Orijinal statik prototip — tasarım karşılaştırma referansı
deploy          Sunucu kurulum dosyaları (nginx, PM2, deploy betiği)
docs            Plan, kararlar (ADR), runbook, güvenlik ve KVKK belgeleri
tools           Kurulum, tasarım karşılaştırma, uçtan uca test, yük testi araçları
```

Mimari kuralı: **mantık serviste, veri tablolarda, istemciler ince, her şey `/api/v1`'den.**
Ayrıntı: [docs/adr/0002-moduler-katmanli-mimari-api-first.md](docs/adr/0002-moduler-katmanli-mimari-api-first.md)

---

## Durum

Yerel geliştirme tamamlandı (F0–F10). Kalan: sunucu kurulumu ve lansman.
Güncel durum ve açık maddeler: [docs/SISTEM-DURUMU.md](docs/SISTEM-DURUMU.md) ·
Fazlar: [docs/YOL-HARITASI.md](docs/YOL-HARITASI.md)

> Bu depo **geliştirme** deposudur; gizli anahtar içermez. `.env` dosyaları yerel olarak üretilir,
> sunucu bilgileri depoya girmez.
