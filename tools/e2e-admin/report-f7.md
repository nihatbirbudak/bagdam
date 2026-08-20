# e2e F7 raporu — abonelik motoru (API düzeyi simülasyon)

- Tarih: 2026-08-20T20:41:12.035Z · API: http://127.0.0.1:4064 · run: mt1zjqzn · takvim: T0=2026-08-25 … T4=2026-09-22 · R0=2026-08-27
- Sonuç: TÜM ADIMLAR OK (11/11)

| Adım | Durum | Süre | Not |
|---|---|---|---|
| 0 hazırlık: admin girişi · sayımlar · ayarlar (dunning [2,12], paymentLinkHours 1) · bölge/tier/ürünler · şablonlar | OK | 1619 ms | users=1 subs=0 cycles=0 orders=0 payments=0 cron=0 · tier sezon (1099 TL) · T0=2026-08-25 R0=2026-08-27 · şablon +11 (yayın 11) |
| a 3 müşteri: POST /auth/register (KVKK) → PUT /me/address (urla) · saklı kartlar (ok: / fail:, psql) | OK | 1512 ms | cmt1zjsej002iwgdoxoj9zozu, cmt1zjsro002rwgdok4wgxzbn, cmt1zjt7u0030wgdosa7ti2e9 |
| b admin POST /admin/subscriptions ×3 (MIT haftalık Salı · PAYMENT_LINK haftalık Salı · tek seferlik Perşembe) → Order PAID (MANUAL) · cycle#1 · ACTIVE · /me/subscription · /me/orders | OK | 988 ms | sub1 #1420 1029.5 TL · sub2 LINK · sub3 tek seferlik 1099 TL |
| c job: cycles:ensure (ufuk 8 hafta, idempotent) · delivery-dates:generate · reminders:cutoff (T1 kesiminden 24 s önce) | OK | 154 ms | ensure created=0 (toplam 8) · generate {"to":"2026-10-13","from":"2026-08-20","weeks":8,"zones":2,"created":0,"updated" · remind 2 |
| d T0 kesimi: lock-and-charge → cycle#1 CHARGED (peşin 0 TL) · /admin/cycles · pick/packing listeleri · ops PREPARING → OUT_FOR_DELIVERY → DELIVERED (Order aynı) | OK | 520 ms | lock {"delta":0,"errors":0,"locked":2,"unpaid":0,"charged":2,"awaiting":0,"cancelled":0,"chargedZero":2,"skippedUnpaid":0,"itemsProcessed":2} · pick 4 satır · packing 2 fiş |
| e R0 kesimi: tek seferlik → CHARGED (0 TL, DELTA yok) → teslim → Subscription COMPLETED → /me/subscription null | OK | 239 ms | sub3 COMPLETED · events CHARGED,LOCKED,ADMIN_NOTE,COMPLETED,ADMIN_NOTE,ADMIN_NOTE,ADMIN_NOTE,ACTIVATED,ADMIN_NOTE,CREATED |
| f müşteri 1: cycle#2 atla (USER, DD −1) → geri al (hak iade, DD +1) · T1 kesimi: MIT → CHARGED + Order PAID + Payment CYCLE_CHARGE | OK | 757 ms | c2 CHARGED 549.5 TL (indirim 549.5) · sipariş #1423 |
| g müşteri 2 (PAYMENT_LINK): T1 AWAITING_PAYMENT + GET /pay/:token → expire → UNPAID (link EXPIRED) → retry yeni link → 08:00 sınırı → SKIPPED(UNPAID) · iptal: teklif → kabul → teklifsiz talep → onay → CANCELLED | OK | 968 ms | c2 SKIPPED(UNPAID) · sub2 CANCELLED effectiveAt=2026-08-20T20:41:18.683Z |
| h müşteri 1: kart fail: → T2 UNPAID (+2 s fail, +12 s fail → SKIPPED(UNPAID)) · T3 aynı → PAST_DUE · kart düzelt → T4 CHARGED → ACTIVE (failedCycles 0) | OK | 1250 ms | c3/c4 SKIPPED(UNPAID) → PAST_DUE → c5 CHARGED → ACTIVE |
| i müşteri 1 iptal: teklif (ilk kez) → onay → CANCELLED; SCHEDULED cycle'lar iptal + DD iade; kilitli/teslim edilmiş cycle'lar korunur · CronLog · admin jobs listesi | OK | 590 ms | sub1 CANCELLED · CronLog 20 koşu SUCCESS · audit 43 |
| z temizlik: test verisi (kullanıcı/abonelik/cycle/sipariş/ödeme/kart/adres/consent/mail/audit/cron/system_logs/şablon) · delivery_dates.reserved geri · ayarlar geri → sayımlar ≡ başlangıç | OK | 3999 ms | users=1 subs=0 cycles=0 orders=0 payments=0 cron=0 templates=2 dd=48 reservedUrla=0 · ayarlar geri |

Zaman job'lara verilen `now` ile ilerletildi (`POST /admin/jobs/:name/run {now}` — yalnız geliştirme/test; üretimde 403). Müşteri uçları gerçek saatle; kesimler gelecekte. Ayarlar (commerce.dunning [2,12], paymentLinkHours 1) koşu süresince değiştirildi ve geri alındı. Sırlar çıktıya yazılmaz (SEED_ADMIN_*, DATABASE_URL apps/api/.env).
