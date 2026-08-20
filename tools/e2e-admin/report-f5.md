# e2e-admin F5 raporu

- Tarih: 2026-08-20T17:03:26.159Z · API: http://127.0.0.1:4043 · Admin: http://127.0.0.1:4044 · run: mt1rrpan
- Sonuç: TÜM ADIMLAR OK (13/13)

| Adım | Durum | Süre | Not |
|---|---|---|---|
| 0 hazırlık: API girişi + başlangıç anlık görüntüleri (site-content, legal, posts, zones, settings, bootstrap) | OK | 343 ms | site-content 22 anahtar · kvkk v1 · legal 11 · posts 3 · urla fee=49 · freeShippingRule=gte · mail.pass hasValue=false · leads 0 · DELIVERY_FEE=49 |
| a giriş → Özet (cookie oturumu) | OK | 484 ms | çerezler: access_token, csrf_token |
| b Site Blokları: home.hero başlığı değiştir → Kaydet → `/` HTML yeni başlık → geri al (API) → eski başlık | OK | 317 ms | yeni başlık /'de görüldü ve geri alındı (updatedBy=cmt1jw8tv0094wg7sl5x4ov38) |
| c Promo/Footer: promoBar metni değiştir → `/index.html` → geri al | OK | 261 ms | promo metni index+urunler'de görüldü ve geri alındı |
| d Günlük: yeni yazı (taslak) → /gunluk.html'de yok → Şimdi yayınla → var (+ /api/v1/posts) → Sil → yok | OK | 722 ms | slug=e2e-yazi-mt1rrpan: taslak→yayın→sil; posts total 3→4→3 |
| e Yasal: KVKK yeni taslak sürüm → düzenle → Yayınla → /politikalar.html + /api/v1/legal/kvkk v+1 → current PUT 409 → eski sürümü yeniden yayınla | OK | 802 ms | kvkk v1 → v2 yayınlandı (politikalar + API), 409 doğru, v1 yeniden yayınlandı |
| f Toptan: /toptan.html formu → 201 → admin Toptan Talepleri → durum CONTACTED → 3/dk/IP (4. istek 429) | OK | 1044 ms | lead=cmt1rrsa4003bwgg0nlz49ssz CONTACTED; throttle 201,201,201,429 |
| g Ayarlar › Bölgeler: Urla ücreti 49→55 → bootstrap + /index.html DELIVERY_FEE → geri 49 | OK | 450 ms | DELIVERY_FEE 49→55→49; dates/generate weeks=2 → created 0, updated 0 |
| h Ayarlar › Genel: commerce.freeShippingRule gte→gt → GET /admin/settings/commerce + bootstrap commerce → geri | OK | 253 ms | gte→gt→gte; bootstrap.commerce'te yansıdı |
| i E-posta: SMTP parolası yaz → GET maskeli+hasValue → DB şifreli (enc:v1, düz metin yok) → test düğmesi 501 → bilgi | OK | 465 ms | maskeli + hasValue; DB enc:v1 (düz metin yok); maske PUT değişmedi; test → F6 bilgisi |
| j audit-logs: content / settings / delivery / wholesale satırları (actorEmail, redaksiyon) | OK | 9 ms | 20 satır: auth:LOGIN, content:CREATE, content:DELETE, content:PUBLISH, content:UPDATE, delivery:CREATE, delivery:UPDATE, settings:UPDATE, wholesale:UPDATE |
| k çıkış → /admin/site-content 401 | OK | 97 ms | 401 doğru |
| z geri alma + temizlik: hero/promo · yazı · KVKK (eski sürüm yayında, v2 taslağı silinir) · toptan talepleri · bölge · commerce · mail.pass → içerik ≡ baseline | OK | 364 ms | site-content ≡, kvkk v1 (1 satır), posts 3, leads 0, DELIVERY_FEE 49, freeShippingRule gte, mail.pass satırı 0 |

Ekran görüntüleri: `tools/e2e-admin/out/f5-*.png`. Sırlar çıktıya yazılmaz; admin kimliği ve DB bağlantısı apps/api/.env (SEED_ADMIN_*, DATABASE_URL).
