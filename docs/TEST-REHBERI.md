# Bağdam — Yerel Kurulum ve Test Rehberi

Bu belge, projeyi **kendi bilgisayarında çalıştırıp test etmek** isteyenler içindir.
Sunucu, alan adı ya da gerçek ödeme gerekmez; her şey `localhost` üzerinde çalışır.

> **Ekran turu:** Kuruluma başlamadan önce neyin nasıl göründüğüne bakmak isterseniz
> `docs/ekran-turu.html` dosyasını tarayıcıda açın (tek dosya, internet gerekmez).

---

## 1. Ön koşullar

| Gerekli | Sürüm | Not |
|---|---|---|
| **Node.js** | 20 veya üzeri | https://nodejs.org (LTS) |
| **pnpm** | 9.x | Yoksa kurulum betiği `corepack` ile etkinleştirir |
| **PostgreSQL** | 14 veya üzeri | Sunucu + `psql` istemcisi. Windows kurulumunda **bin klasörünü PATH'e ekleyin** |
| **Git** | — | Depoyu almak için |

PostgreSQL kurulumunda belirlediğiniz **`postgres` kullanıcısının parolasını** not edin; kurulum betiği isteyecek.

---

## 2. Kurulum (tek komut)

```bash
git clone https://github.com/nihatbirbudak/bagdam.git
cd bagdam
node tools/setup-local.mjs --su-pass=POSTGRES_PAROLANIZ
```

Betik sırayla şunları yapar (tekrar çalıştırmak zararsızdır):

1. Node / pnpm / psql denetimi
2. PostgreSQL'de `bagdam` rolü + `bagdam_dev` ve `bagdam_test` veritabanları
3. `.env` dosyalarını **rastgele gizli anahtarlarla** üretir (var olanlara dokunmaz)
4. Bağımlılıklar, Prisma istemcisi, migration'lar, örnek veri
5. Derleme + **yönetici giriş bilgilerini ekrana yazar**

> `postgres` kullanıcısı parolasız bağlanıyorsa `--su-pass` vermeyin.
> Farklı sunucu/port için: `--pg-host=... --pg-port=...`

### Çalıştırma

İki ayrı terminal:

```bash
pnpm dev:api      # site + API   → http://localhost:4010
pnpm dev:admin    # yönetim paneli → http://localhost:4011
```

| Adres | Ne |
|---|---|
| http://localhost:4010 | **Site** (müşterinin gördüğü) |
| http://localhost:4011 | **Yönetim paneli** |
| http://localhost:4010/api/v1/health | API sağlık kontrolü (`{"status":"ok","db":"up"}`) |

**Yönetici girişi:** kurulum betiğinin sonunda yazdığı e-posta ve parola.
Sonradan görmek için: `apps/api/.env` içindeki `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

---

## 3. Bu sürümde ne var?

| Alan | Durum |
|---|---|
| Site tasarımı | Prototiple **piksel piksel aynı** (30/30 ekran, 0 piksel fark) — fark: içerik artık veritabanından |
| Katalog | 22 ürün, 15 üretici, 4 kategori, parti (lot) takibi, medya kütüphanesi (85 görsel) |
| Kutu aboneliği | 2 kutu tipi, haftalık şablon, ürün değiştirme, ekstralar, frekans, teslimat günü |
| Abonelik motoru | Otomatik haftalık döngü, kesim saati, tahsilat, atlama, iptal + kalma teklifi, telafi |
| Üyelik | Kayıt, e-posta doğrulama, parola sıfırlama, adres, siparişlerim, aboneliğim |
| Ödeme | **PayTR** entegrasyonu (test modunda; aşağıya bakın) + kupon |
| Yönetim paneli | 23 ekran: katalog, içerik, yasal metinler, siparişler, abonelikler, teslimat günü, müşteriler, ayarlar, sistem |
| Bildirimler | 16 e-posta şablonu (panelden düzenlenebilir) |
| Yasal | Çerez onayı, KVKK veri saklama + otomatik temizlik, sürümlü sözleşmeler |

### Test ortamının sınırları (bilerek böyle)

| Konu | Yerelde davranış |
|---|---|
| **Ödeme** | `PAYMENT_PROVIDER=manual` — sipariş "test ödemesi onaylandı" ile tamamlanır, **gerçek tahsilat yapılmaz**. PayTR mağaza bilgileri girilirse gerçek akış devreye girer |
| **E-posta** | `DISABLE_MAIL=true` — mail gönderilmez, yerine `apps/api/logs/mail/<id>.html` önizleme dosyası yazılır. Panelde **Sistem › E-posta günlüğü**'nden görülür |
| **Zamanlı işler** | `ENABLE_CRON=false` — otomatik çalışmaz. Panelden **Sistem › İşler**'den elle tetiklenebilir |

---

## 4. Ne test edilmeli? (önerilen tur, ~20 dakika)

### A. Site — ziyaretçi
1. **Ana sayfa** → çerez şeridi çıkıyor mu? "Yönet" ile kategori seçimi, "Kabul Et"ten sonra bir daha çıkmamalı
2. **Tüm ürünler** → kategori sekmeleri (taze kutular / süt ürünleri / fırın / kiler)
3. **Ürün detayı** → parti kodu, "neden bu ürünü seçtik", saklama/alerjen metinleri, tercih seçimi (ör. olgunluk)
4. **Sepete ekle** → yüzen sepet sayacı, sepet çekmecesi
5. **Günlük**, **Toptan** (form gönderin → panelde görünmeli), **Politikalar**, **Nasıl seçiyoruz**

### B. Üyelik
6. **Üye ol** (KVKK kutusu zorunlu) → otomatik giriş
7. **Sistem › E-posta günlüğü**'nde "hoş geldin" ve "doğrulama" mailleri; önizleme dosyasındaki doğrulama bağlantısına tıklayın → hesap doğrulanır
8. **Çıkış → Parolamı unuttum** → önizlemedeki bağlantı ile yeni parola
9. **Adres** kaydedin (ilçe: Urla / Çeşme)

### C. Sipariş
10. Sepete ürün ekleyip **sepet** sayfasında adımları izleyin: teslimat günü → yasal onaylar → (isterseniz panelden kupon oluşturup deneyin) → **siparişi tamamla**
11. **Hesabım › Siparişlerim**'de görünmeli; panelde **Siparişler**'de durum değiştirin (Hazırlanıyor → Yolda → Teslim edildi) — her adımda e-posta günlüğüne satır düşmeli

### D. Abonelik (asıl iş)
12. **Kutu kur** → tier seç, içerik değiştir, ekstra ekle, frekans + teslimat günü → **aboneliği başlat** → sepetten ödeme
13. **Hesabım**'da abonelik kartı: kesim geri sayımı, bu haftanın kutusu
14. İçeriği değiştir · **haftayı atla** → geri al · frekans/gün değiştir
15. **İptal et** → kalma teklifi gelir → vazgeç → tekrar iptal → onayla

### E. Yönetim paneli
16. **Ürünler** → bir ürünün fiyatını değiştirin, sitede **anında** görünmeli (60 sn önbellek)
17. **Haftanın Kutusu** → şablona ürün ekleyip **yayınlayın** → kutu sayfasına yansımalı
18. **İçerik** → ana sayfa başlığını değiştirin → sitede görünmeli
19. **Teslimat Günü** → toplama listesi + paketleme fişi + **yazdırma görünümü**
20. **Sistem** → denetim kayıtları (kim ne yaptı), cron, e-posta, webhook

---

## 5. Sık karşılaşılan sorunlar

| Belirti | Çözüm |
|---|---|
| `psql: command not found` | PostgreSQL `bin` klasörünü PATH'e ekleyin (Windows: `C:\Program Files\PostgreSQL\16\bin`) |
| `PostgreSQL sunucusuna bağlanılamadı` | Servis çalışıyor mu? Parola için `--su-pass=...` verin |
| Port 4010/4011 dolu | `pnpm dev:api` öncesi ilgili süreci kapatın; port `apps/api/.env` → `PORT` ile değişir |
| Sayfa açılıyor ama ürün yok | `pnpm db:seed` çalıştırın |
| Panelde giriş olmuyor | `apps/api/.env` içindeki `SEED_ADMIN_*` değerlerini kullanın; parolayı değiştirdiyseniz `pnpm db:seed` yeni parolayı **yazmaz** (mevcut kullanıcı korunur) |
| Her şeyi sıfırlamak | `pnpm db:reset` (tüm veriyi siler, migration + seed'i baştan uygular) |

---

## 6. Faydalı komutlar

```bash
pnpm dev:api            # site + API (izleme modunda)
pnpm dev:admin          # yönetim paneli
pnpm build              # üçünü de derle
pnpm test               # tüm testler (API 395, panel 228, ortak 117)
pnpm db:studio          # veritabanını tarayıcıda gez (Prisma Studio)
pnpm db:seed            # örnek veriyi yükle (mevcut kayıtları korur)
pnpm db:reset           # veritabanını sıfırla + seed
node tools/hbs-check.mjs           # şablon derleme denetimi
node tools/visual-parity/run.mjs   # tasarım karşılaştırması (eski prototiple)
```

Tasarım karşılaştırması için eski statik prototipi ayrı bir terminalde yayınlamanız gerekir:

```bash
cd website && npx http-server . -p 8080 -c-1
node tools/visual-parity/run.mjs --old=http://127.0.0.1:8080 --new=http://127.0.0.1:4010 --mask=#forgotNote,#cookieConsent
```

---

## 7. Belgeler

| Dosya | İçerik |
|---|---|
| [YOL-HARITASI.md](YOL-HARITASI.md) | Fazlar, yapılanlar, kalanlar |
| [BACKEND-PLANI.md](BACKEND-PLANI.md) | Mimari, veri modeli, API, ekranlar |
| [adr/](adr/) | 21 mimari/iş kararı ve gerekçeleri |
| [RUNBOOK.md](RUNBOOK.md) | Günlük operasyon, olay müdahale, lansman listesi |
| [SISTEM-DURUMU.md](SISTEM-DURUMU.md) | Sistemin anlık durumu, açık maddeler |
| [guvenlik-denetimi.md](guvenlik-denetimi.md) | Güvenlik denetimi raporu |
| [kvkk-veri-saklama.md](kvkk-veri-saklama.md) | Veri saklama matrisi |
| [ekran-turu.html](ekran-turu.html) | Ekran görüntüleriyle tanıtım (tarayıcıda açın) |

---

## 8. Geri bildirim

Test sırasında bulduğunuz sorunlar için lütfen şunları not edin: **hangi sayfa**, **hangi adım**,
**ne bekliyordunuz / ne oldu**, mümkünse **ekran görüntüsü** ve tarayıcı konsolundaki hata.
Yönetim panelinde **Sistem › Denetim kayıtları** ve **Sistem › Sistem kayıtları** çoğu sorunun izini taşır.
