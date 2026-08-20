# e2e-admin raporu

- Tarih: 2026-08-20T15:53:53.775Z · API: http://127.0.0.1:4033 · Admin: http://127.0.0.1:4034 · ürün: zeytinyagi · run: mt1pa9v2
- Sonuç: TÜM ADIMLAR OK (12/12)

| Adım | Durum | Süre | Not |
|---|---|---|---|
| 0 hazırlık: API girişi, bootstrap baseline, hedef ürün | OK | 335 ms | Sızma Zeytinyağı fiyat=480 batch=ZY-11 img=assets/images/urunler/zeytinyagi.jpg; hafta=2026-08-17 sezon.items=10 small.items=6 |
| a giriş → Özet (cookie oturumu) | OK | 536 ms | çerezler: access_token, csrf_token |
| b ürün formu: fiyat 480 → 485 → Kaydet → toast | OK | 416 ms |  |
| c bootstrap ve /urun.html gömülü yükte yeni fiyat (cache invalidation) | OK | 25 ms | bootstrap.price=485, urun.html price=485 |
| d Partiler: yeni parti ZY-12 + neden seçtik → Güncel yap → bootstrap batch/why | OK | 583 ms | batch=ZY-12 |
| e Medya: PNG yükle → listede → ürün Görseller picker → Kapak → bootstrap img | OK | 1028 ms | img=uploads/urunler/e2e-cig-domates-mt1pa9v2-mt1pabir-9cf193.webp |
| f1 Haftanın Kutusu (sezon): ürün çıkar + havuzdan ekle → Yayınla → bootstrap/kutu.html templates.sezon | OK | 945 ms | çıkarıldı=incir, eklendi=incir (havuzda başka taze ürün yoktu → aynı ürün sona eklendi) |
| f2 Haftanın Kutusu (small): ürün çıkar + BAŞKA taze ürün ekle → Yayınla → bootstrap/kutu.html templates.small | OK | 931 ms | çıkarıldı=incir, eklendi=misir |
| g Kategoriler: panelNote düzenle → admin API yansır (HTML F5: CMS — atlandı) | OK | 402 ms | admin API'de güncel; /urunler.html'de yok (F3: panel metinleri statik, F5 CMS ile gelecek — beklenen) |
| h audit-logs: bu oturumun işlemleri (actorEmail/module/action) | OK | 8 ms | 13 satır: catalog:UPDATE, catalog:PUBLISH, catalog:CREATE, media:UPLOAD, auth:LOGIN |
| i çıkış → /admin/products 401; CSRF’siz POST 403 | OK | 119 ms | çerezler temizlendi; 401/403 doğru |
| z geri alma: fiyat · parti · görsel/medya · şablon · kategori → bootstrap ≡ baseline | OK | 122 ms | bootstrap (products/tiers/templates/pool/pairIds) baseline ile aynı |

Ekran görüntüleri: `tools/e2e-admin/out/`. Sırlar çıktıya yazılmaz; admin kimliği apps/api/.env (SEED_ADMIN_*).
