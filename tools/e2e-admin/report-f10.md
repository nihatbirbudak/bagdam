# e2e F10 — bildirimler + çerez onayı + KVKK + Sistem ekranı + güvenlik

- Tarih: 2026-08-21T08:41:04.741Z · Süre: 23.4 s
- API: `http://127.0.0.1:4094` (geçici; PAYMENT_PROVIDER=manual, ENABLE_CRON=false, DISABLE_MAIL=true) · Admin: `http://localhost:4095` (vite preview, proxy)
- Müşteriler: `e2e-f10a-mt2p9ip0@example.com` (bildirim/iptal) · `e2e-f10b-mt2p9ip0@example.com` (tahsilat hatası/teslimat) · sağlayıcı: ManualProvider (`ok:` / `fail:` kart)
- Zaman yalnız job'lara verilen `now` ile ilerletildi (`POST /admin/jobs/:name/run {now}` — üretimde 403). `cookies.*` ayarları koşu süresince açıldı ve geri alındı.
- E-postalar `DISABLE_MAIL=true` altında MailLog(SKIPPED) + `logs/mail/<id>.html` önizlemesi üretir; içerik oradan okundu.
- Sonuç: **16/16** — tümü OK

| # | Adım | Sonuç | Süre | Not |
|---|---|---|---|---|
| 1 | a hazırlık: admin girişi (API + panel) · sayımlar · ayar anlık görüntüsü · çerez kategorileri açılır | OK | 2073 ms | 17 tablo · privacy {"retentionMonths":120,"mailLogDays":90,"systemLogDays":30,"cronLogDays":90,"auditPiiMonths":12,"anonymizeInactiveMonths":0} · cookies {"analyticsEnabled":false,"marketingEnabled":false} → ikisi de açık |
| 2 | b çerez şeridi 10 sayfada SUNUCUDA GİZLİ basılır (display:none + position:fixed) — parite bozulmaz | OK | 119 ms | 10/10 sayfa · şerit varsayılan gizli |
| 3 | c çerez şeridi "Reddet": JS ile görünür → reddet → Consent ×2 granted=false · yeniden yüklemede yok | OK | 1257 ms | guestKey gmt2p9kzhg… · COOKIE_ANALYTICS=false · COOKIE_MARKETING=false |
| 4 | d çerez şeridi "Yönet": analitik açık / pazarlama kapalı → "Seçimimi kaydet" → Consent true/false | OK | 439 ms | COOKIE_ANALYTICS=true · COOKIE_MARKETING=false |
| 5 | e çerez şeridi "Kabul Et" (ikisi de true) · pazarlama ayarı kapalıyken şeritte hiç basılmaz | OK | 2384 ms | Kabul Et → 2 onay true · kapalı pazarlama: markup yok, Consent yok |
| 6 | f0 haftanın kutusu: sonraki 4 hafta için şablon kopyası + yayın (cycles:ensure şablonsuz hafta görmemeli) | OK | 140 ms | hafta 2026-08-17…2026-09-07 · +3 şablon (yayın 3) · 6 öğe |
| 7 | f müşteri A: kayıt + adres + `ok:` kart → admin manuel checkout (MIT) → ACTIVE + cycle#1 → cycles:ensure | OK | 572 ms | sub cmt2p9o4… · cycle#1 2026-08-25 · cycle#2 2026-09-01 |
| 8 | g reminders:cutoff → MailLog `cutoff-reminder` (kutu içeriği + teslimat günü) · ikinci koşu tekrar göndermez | OK | 248 ms | 6 ürün + teslimat günü önizlemede · koşu1 sent=1 · koşu2 yeni satır yok (1) |
| 9 | h cycles:lock-and-charge → cycle#2 CHARGED → MailLog `cycle-charged` (tutar + sipariş no) | OK | 627 ms | cycle#2 CHARGED · konu "Bu haftanın kutusu hazırlanıyor — 01.09.2026 · Bağdam" · sipariş #3630 |
| 10 | i müşteri B (`fail:` kart): kesim → cycle UNPAID → MailLog `cycle-payment-failed` (kart linki + yeniden deneme) | OK | 1082 ms | B cycle#2 UNPAID · deneme 1 maili · kart linki /uyelik.html · konu "Tahsilat alınamadı — 01.09.2026 kutun · Bağdam" |
| 11 | j teslimat durum mailleri: panelden OUT_FOR_DELIVERY → `order-shipped`, DELIVERED → `order-delivered`; B → `order-delivery-failed` | OK | 2163 ms | #3630: shipped + delivered · B siparişi delivery-failed (gerekçe önizlemede) |
| 12 | k iptal teyidi: /me/subscription/cancel → confirm → MailLog `subscription-cancelled` (son kutu) | OK | 473 ms | abonelik CANCELLED · konu "Aboneliğin iptal edildi · Bağdam" |
| 13 | l kvkk:purge: eski MailLog/SystemLog/CronLog silinir (+ önizleme dosyası) · eski AuditLog PII `[silindi]` · taze satır durur | OK | 510 ms | mail 1 (+1 önizleme) · system 1 · cron 1 · audit 1/1 maskelendi · kapalı: anonymizeInactiveMonths |
| 14 | m ekran 22 Sistem: Sağlık kartı (health/detailed) + Denetim/Sistem/Cron/E-posta/Webhook sekmeleri dolu | OK | 4702 ms | sağlık ok · sekme satırları Denetim:25 Sistem:4 Cron:8 E-posta:15 Webhook:1 |
| 15 | n güvenlik: oturumsuz admin 401 · IDOR 403/404 · CSRF'siz mutasyon 403 · CSP (web/admin/api) + PayTR frame-src | OK | 272 ms | 6 admin ucu oturumsuz 401 · IDOR: sipariş 404 · admin uçları 403 · CSRF'siz PATCH 403 (code=CSRF_INVALID) · CSP web/api ayrı · PayTR frame-src · HSTS yok (dev) · X-Powered-By yok · sır: GET maskeli · yanıtta enc:v1: yok · DB'de şifreli |
| 16 | z temizlik: koşunun ürettiği satırlar silinir, ayarlar geri → 17 tablo ≡ başlangıç | OK | 6100 ms | 17 tablo ≡ başlangıç · reserved geri · cookies/privacy ayarları geri |

## Ekran görüntüleri

`tools/e2e-admin/out/f10-*.png` (gitignore).

## Sayfa hataları (konsol/pageerror)

- site console: Failed to load resource: the server responded with a status of 401 (Unauthorized)
