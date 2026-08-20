# e2e F8 — checkout + ödeme + kupon + admin siparişler (site + panel + API + psql)

- Tarih: 2026-08-20T23:00:51.028Z · Süre: 18.2 s
- API: `http://127.0.0.1:4074` (geçici; PAYMENT_PROVIDER=manual, ENABLE_CRON=false, DISABLE_MAIL=true) · Admin: `http://127.0.0.1:4075` (vite preview, proxy)
- Kupon: `E2EF8MT24JC9F` (%10, SINGLE) · Müşteri: `e2e-f8-mt24jc9f@example.com` · PayTR: sahte mağaza bilgileri (dışarıya istek YOK)
- Sonuç: **17/17** — tümü OK

| # | Adım | Sonuç | Süre | Not |
|---|---|---|---|---|
| 1 | a hazırlık: admin girişi · başlangıç sayımları · delivery_dates.reserved · payment.* ayarları saklandı | OK | 1486 ms | orders=0 payments=0 coupons=0 dd=50 |
| 2 | b admin paneli › Kuponlar: E2EF8MT24JC9F (%10, SINGLE) oluşturuldu → GET /admin/coupons | OK | 858 ms | id=cmt24je5r002fwgooadwvl10m usedCount=0 |
| 3 | c müşteri kaydı (POST /auth/register, KVKK) + adres (PUT /me/address, urla) | OK | 343 ms | user=cmt24jee… adres=cmt24jei… |
| 4 | d tarayıcı: /urun.html?id=ekmek → sepete ekle → /sepet.html giriş kapısı → giriş → adımlar açılır | OK | 2150 ms | sepet 1 satır · form dolu (Urla) |
| 5 | e teslimat günü (GET /delivery/dates) · yasal onay kutuları (requiresAck) · kupon → özet API'den (indirim satırı) | OK | 282 ms | gün=Salı · belge mesafeli-satis+on-bilgilendirme · toplam 134.50 TL (kupon −9.50) |
| 6 | f "siparişi tamamla" → manual sağlayıcı → Order PAID · başarı görünümü · sepet + kutu taslağı temizlendi | OK | 271 ms | #2263 PAID · 134.50 TL (kargo 49.00) · ödeme ord2263iybk |
| 7 | g /sepet.html?siparis=<no>&odeme=ok (PayTR merchant_ok_url dönüşü) → teşekkür + adres çubuğu temizlenir | OK | 646 ms | ?siparis=2263&odeme=ok → teşekkür, sorgu temizlendi |
| 8 | h /uyelik.html "önceki siparişler" + GET /me/orders · mail.order-paid SKIPPED + önizleme | OK | 753 ms | #2263 üyelikte · order-paid SKIPPED (önizleme) |
| 9 | i admin Siparişler: arama #no → PAID · detay · CouponRedemption + usedCount 1 | OK | 341 ms | panel detay OK · redemption 1 · usedCount 1 |
| 10 | i2 admin Ayarlar › Ödeme (PayTR alanları registry'den + uyarı şeridi) · Özet "Bugün — sipariş ve ciro" kartı | OK | 252 ms | PayTR alanları + manuel sağlayıcı uyarısı · Özet bugünkü sipariş/ciro kartı |
| 11 | j panelden durum geçişleri: Hazırlanıyor → Yolda → Teslim edildi (shared makine düğmeleri) | OK | 1111 ms | PAID → PREPARING → OUT_FOR_DELIVERY → DELIVERED |
| 12 | k CSV dışa aktar (GET /admin/orders/export.csv) siparişi içerir | OK | 7 ms | 2 satır |
| 13 | l iade (ManualProvider · POST /admin/payments/:id/refund) → Payment REFUNDED + Order REFUNDED + kupon kullanımı geri | OK | 275 ms | iade 134.50 TL · Order REFUNDED · kupon serbest |
| 14 | m /kutu.html?tier=sezon taslağı → /sepet.html abonelik checkout (SUBSCRIPTION_CONTRACT_ACK) → ACTIVE + cycle#1 prepaid (kargo hariç) | OK | 2923 ms | #2264 SUBSCRIPTION PAID · sub ACTIVE · cycle#1 SCHEDULED prepaid 549.50 (kargo 0.00 siparişte) |
| 15 | n iptal akışı (API): cancel → retention teklifi → ikinci talep → confirm → CANCELLED | OK | 157 ms | CANCELLED (kalma teklifi %50 × 1) |
| 16 | o PayTR bildirimi: geçerli hash → PAID · ikinci teslim IGNORED · geçersiz hash 400 · IP allowlist 403 | OK | 964 ms | oid=ordE2Emt24jc9f · 400 bad hash · 403 IP · OK → PAID · ikinci teslim IGNORED |
| 17 | z temizlik: kupon/sipariş/ödeme/abonelik/kullanıcı/consent/mail/webhook silindi · reserved geri · payment.* geri → sayımlar ≡ başlangıç | OK | 5086 ms | sayımlar ≡ başlangıç (16 tablo) · reserved geri |

## Ekran görüntüleri

`tools/e2e-admin/out/f8-*.png` (gitignore).
