# e2e F9 — abonelik yönetimi (site) + ops ekranları (panel)

- Tarih: 2026-08-21T05:16:11.271Z · Süre: 26.6 s
- API: `http://127.0.0.1:4088` (geçici; PAYMENT_PROVIDER=manual, ENABLE_CRON=false, DISABLE_MAIL=true) · Admin: `http://127.0.0.1:4089` (vite preview, proxy)
- Müşteriler: `e2e-f9a-mt2hy0zr@example.com` (site akışı) · `e2e-f9b-mt2hy0zr@example.com` (ops/tahsilat) · sağlayıcı: ManualProvider (`ok:` / `fail:` kart)
- Zaman yalnız job'lara verilen `now` ile ilerletildi (`POST /admin/jobs/:name/run {now}` — üretimde 403). Ayarlar (commerce.dunning [2,12], firstCycleSkippable, deliveryDatesHorizonWeeks 2) koşu süresince değiştirildi ve geri alındı.
- Sonuç: **19/19** — tümü OK

| # | Adım | Sonuç | Süre | Not |
|---|---|---|---|---|
| 1 | a hazırlık: admin girişi · 16 tablo sayımı · delivery_dates.reserved · commerce ayarları (dunning [2,12] · ilk kutu atlanabilir · ufuk 2 hafta) | OK | 1321 ms | sayımlar users=1 subs=0 cycles=0 orders=0 dd=50 · tier small (649 TL) |
| 2 | b haftanın kutusu şablonları: sonraki 4 hafta için kopya + yayınla (cycles:ensure şablonsuz hafta görmemeli) | OK | 140 ms | hafta 2026-08-17…2026-09-07 · +3 şablon (yayın 3) · 6 öğe |
| 3 | c müşteri A kaydı (POST /auth/register, KVKK) + adres (PUT /me/address, urla) | OK | 384 ms | user=cmt2hy2g… adres=cmt2hy2j… kart 0009 |
| 4 | d site: /kutu.html → "aboneliği başlat" → /sepet.html (gün + SUBSCRIPTION_CONTRACT_ACK) → Order SUBSCRIPTION PAID · Subscription ACTIVE · cycle#1 | OK | 3325 ms | #3001 PAID · sub ACTIVE · cycle#1 SCHEDULED 2026-08-25 (sali) · toplam 2 cycle · kart ****0009 |
| 5 | e /uyelik.html: abonelik kartı · bu haftanın kutusu (ürün adları) · kesim geri sayımı · "Bu haftaki ödeme" | OK | 693 ms | kutu 6 ürün · kesim 2026-08-24T09:00:00.000Z · sonraki teslimat 2026-08-25 |
| 6 | f teslimat günü değiştir (kart içi gün düğmesi → "değişiklikleri onayla" → PATCH /me/subscription; cycle#1 aynı hafta taşınır) | OK | 517 ms | 2026-08-27 (persembe) · cycle sayısı 2 |
| 7 | g /kutu.html canlı mod: tier/tür düğmeleri pasif (ADR-0008) · swap + ürün tercihi + ekstra → onayla · frekans 1hafta ↔ 2hafta | OK | 1213 ms | swap incir→misir · ekstra incir · tercih misir=Tam olgun · freq 1hafta↔2hafta |
| 8 | h /sepet.html: tekil ürün sepete → "bu haftaki kutuma ekle" (POST …/cycles/current/merge-cart) → sepet boşalır, satır kutuya geçer | OK | 1736 ms | CART_MERGE:ekmek · satır 7 → 8 |
| 9 | i /uyelik.html: haftayı atla (onay sorusu → evet) → SKIPPED + rozet · geri al → SCHEDULED (DD rezervi −1/+1) | OK | 1305 ms | SKIPPED → SCHEDULED · reserved 1 → 0 → 1 |
| 10 | j kesim: cycles:lock-and-charge {now = kesim +1 dk} → cycle#1 CHARGED (peşin, 0 TL) · müşteri DTO'sunda kilitli kutu | OK | 745 ms | cycle#1 CHARGED · chargedZero=0 locked=1 · sıradaki kutu 2026-09-03 |
| 11 | k iptal akışı (site): talep → kalma teklifi → "iptalden vazgeç" → ACTIVE → tekrar talep (teklifsiz) → onayla → CANCELLED | OK | 1050 ms | CANCEL_REQUESTED → ABANDONED → CANCEL_REQUESTED → CANCELLED · cycle#1 CHARGED korundu |
| 12 | l admin ekran 19 (Abonelikler): liste araması → detay (künye · kutu geçmişi · olay günlüğü · iptal kaydı) | OK | 735 ms | cycle 2 · olay 20 (17 tür) · iptal kaydı 2 |
| 13 | m admin ekran 20 (Teslimat Günü): kutular · toplama listesi (ürün/tercih) · paketleme fişi · yazdırma görünümü · toplu durum PREPARING → OUT_FOR_DELIVERY → DELIVERED | OK | 1731 ms | toplama 8 ürün · paketleme 1 fiş · özet kutu 1 · PREPARING → OUT_FOR_DELIVERY → DELIVERED |
| 14 | n müşteri B: kayıt + adres + saklı kartlar (ok:/fail:, psql) → admin manuel checkout (MIT) → cycles:ensure (cycle#2) | OK | 576 ms | B sub cmt2hyd0… · cycle#1 2026-08-25 · cycle#2 2026-09-01 (fail: kart) |
| 15 | o kesim (B cycle#2): cycles:lock-and-charge → `fail:` kart reddedilir → cycle#2 UNPAID (dunning +2 s) | OK | 113 ms | cycle#1 CHARGED · cycle#2 UNPAID · deneme 0 · sıradaki 2026-08-31T11:01:00.000Z |
| 16 | p admin ekran 18 (Ödeme Problemleri): UNPAID kutu listede → kart düzeltilir → "yeniden çek" → CHARGED | OK | 690 ms | UNPAID → CHARGED · liste 2 → 0 |
| 17 | q admin ekran 14b (Teslimat tarihleri): kapasite düzenle · günü kapat/aç · "Tarih üret" (idempotent) | OK | 4288 ms | 2026-08-29: kapasite 999 → 998 → 999 · CLOSED → OPEN · generate +0 (50 satır) |
| 18 | r admin ekran 21 (Özet): kartlar GET /admin/dashboard ile birebir | OK | 170 ms | aktif 1 · haftalık sipariş 3 (973.50 TL) · kesim satırı 4 · olay 12 |
| 19 | z temizlik: müşteri/abonelik/cycle/sipariş/ödeme/kart/olay/şablon/cron/audit satırları silindi · reserved geri · commerce ayarları geri → 16 tablo ≡ başlangıç | OK | 5586 ms | 16 tablo ≡ başlangıç · reserved geri · commerce ayarları geri |

## Ekran görüntüleri

`tools/e2e-admin/out/f9-*.png` (gitignore).
