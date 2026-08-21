# Bağdam — API yük testi raporu (F10 · C)

> Üretildi: 2026-08-21 07:12:48 (UTC) · araç: `tools/load/run.mjs` (çekirdek node:http, ek bağımlılık yok)

## Koşu parametreleri

| Parametre | Değer |
|---|---|
| Hedef | `http://127.0.0.1:4093` (geçici API — dev :4010'a dokunulmadı) |
| Eşzamanlılık | 20 sanal kullanıcı (keep-alive) |
| Senaryo başına süre | ısınma 3 s + ölçüm 10 s |
| İstemci IP | istek başına ayrı `X-Forwarded-For` |
| Node | v20.20.2 · win32/x64 |
| p95 hedefi | < 300 ms |

## Sonuçlar

| Senaryo | Uç | İstek | RPS | ort. | p50 | p90 | p95 | p99 | max | hata % | yük (kB/istek) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `web:index` | `GET /index.html` | 2072 | 205.7 | 96.9 | 95.4 | 107.4 | **113.0** | 122.1 | 132.9 | 0.00 | 41.4 |
| `api:bootstrap` | `GET /api/v1/bootstrap` | 14316 | 1429.9 | 14.0 | 13.6 | 15.7 | **16.5** | 19.6 | 28.3 | 0.00 | 14.5 |
| `web:urunler` | `GET /urunler.html` | 4367 | 435.3 | 45.9 | 45.2 | 49.9 | **52.4** | 62.2 | 74.7 | 0.00 | 29.3 |
| `api:checkout-quote` | `POST /api/v1/checkout/quote` | 5721 | 571.4 | 34.9 | 33.9 | 40.1 | **43.3** | 53.0 | 70.0 | 0.00 | 0.7 |

Süreler milisaniye; ölçüm isteğin yazılmasından yanıt gövdesinin tamamı okunana kadar (TTLB).

### Durum kodu dağılımı

| Senaryo | Kodlar |
|---|---|
| `web:index` | 200: 2072 |
| `api:bootstrap` | 200: 14316 |
| `web:urunler` | 200: 4367 |
| `api:checkout-quote` | 200: 5721 |

## Önbellek doğrulaması

| Yol | Durum | `Cache-Control` | `Vary` | Gövde (kB) |
|---|---:|---|---|---:|
| `/index.html` | 200 | `public, max-age=0, s-maxage=10` | `Origin, Accept-Encoding` | 41.4 |
| `/urunler.html` | 200 | `public, max-age=0, s-maxage=10` | `Origin, Accept-Encoding` | 29.3 |
| `/api/v1/bootstrap` | 200 | `public, max-age=60` | `Origin, Accept-Encoding` | 14.5 |
| `/api/v1/health` | 200 | `(yok)` | `Origin, Accept-Encoding` | 0.1 |

Bootstrap in-process önbelleği (60 s, `CACHE_KEYS.bootstrapAnonymous`): art arda 12 tekil istekte ilk **3.9 ms**, kalanların ortancası **3.2 ms** (en kötü 4.2 ms). Süreç zaten ayakta olduğu için buradaki "ilk istek" gerçek soğuk yol değildir; gerçek soğuk/sıcak farkı `tools/load/n1-report.md` içinde yeni başlatılmış süreçte ölçülür (ana sayfa soğuk ~23 sorgu → sıcak 2).

## Değerlendirme

- Tüm senaryolarda p95 < 300 ms hedefi sağlandı.
- Hata oranı tüm senaryolarda ≤ %1.
- `GET /index.html` diğer sayfalardan yavaştır (p95 ~2×): en büyük gövde (41.4 kB) ve en çok partial ona aittir;
  N+1 taraması sıcak yolda yalnız 2 sorgu gösteriyor (`tools/load/n1-report.md`) → maliyet Handlebars render + gzip, DB değil.
- Ölçüm nginx/Cloudflare olmadan doğrudan Node sürecine yapılır. Üretimde HTML için `proxy_cache bagdam_html`
  (`s-maxage=10`) ve `/assets/*` immutable cache devreye girdiğinden anonim sayfa gecikmesi bu değerlerin altına iner.

## Admin paneli paket boyutu (F10 · C kod bölme)

`apps/admin/src/app/router.tsx` her ekranı `React.lazy` ile ayırır; `vite.config.ts` React ve React Router'ı
ayrı satıcı chunk'larına alır. `pnpm --filter @bagdam/admin build` çıktısı:

| | Önce (F9) | Sonra (F10) |
|---|---:|---:|
| Chunk sayısı | 1 | 86 |
| En büyük chunk | 735.6 kB | 193.8 kB (`vendor-react`) |
| İlk açılışta inen JS | 735.6 kB | 347.4 kB (`index` 114.9 + `vendor-react` 193.8 + `vendor-router` 38.7) |
| Vite 500 kB uyarısı | var | yok |

Ekran chunk'ları 0.5–31.5 kB arası ve yalnız o rotaya gidilince iner. Satıcı chunk'ları sürüm yükseltmesi
dışında değişmediği için `location /app/` altında 1 yıl immutable önbelleklenebilir (deploy/nginx).

## Yeniden koşturma

```bash
# 1) geçici API (dev :4010 çalışmaya devam edebilir)
PORT=4093 HOST=127.0.0.1 ENABLE_CRON=false DISABLE_MAIL=true node apps/api/dist/main.js
# 2) yük testi
node tools/load/run.mjs --api=http://127.0.0.1:4093 --conn=20 --duration=10
```
