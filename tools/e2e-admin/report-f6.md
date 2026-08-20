# e2e F6 raporu — üyelik + hesap + adres + e-posta çekirdeği

- Tarih: 2026-08-20T18:13:12.861Z · API: http://127.0.0.1:4053 · Admin: http://127.0.0.1:4054 · run: mt1u9frx
- Sonuç: TÜM ADIMLAR OK (19/19)

| Adım | Durum | Süre | Not |
|---|---|---|---|
| 0 hazırlık: admin API girişi · başlangıç sayımları · anonim /uyelik.html me:null + public cache | OK | 572 ms | users=1 mail_logs=0 addresses=0 customers.total=1 · anonim Cache-Control "public, max-age=0, s-maxage=10" · zones urla,cesme |
| a site /uyelik.html → Üye ol (KVKK işaretli, pazarlama işaretsiz) → anında giriş: bootstrap me, hesap görünümü, çerezler, no-store, Consent satırları | OK | 1443 ms | uid=cmt1u9h5h0041wgr4rfmep6kb; çerezler access_token,csrf_token; Cache-Control "private, no-store"; consents KVKK_ACK:true:NOT_APPLICABLE:HS_WEB \| MARKETING_EMAIL:false:PENDING:HS_WEB |
| b MailLog welcome+verify SKIPPED + önizleme dosyası → verify bağlantısı → 302 ?dogrulandi=1 → emailVerifiedAt dolu → sayfada bilgi notu | OK | 770 ms | welcome cmt1u9h720045wgr49iqwasi0 · verify cmt1u9h780046wgr49y2a14wb → 302 /uyelik.html?dogrulandi=1 · emailVerifiedAt 2026-08-20 21:13:15 · not "E-posta adresin doğrulandı — teşekkürler." |
| c çıkış (POST /auth/logout 204) → giriş formu geri, çerezler silindi, yenilemede anonim | OK | 645 ms | logout 204; çerez yok; me null; refreshTokenHash null |
| d giriş: yanlış parola → mesaj · "parolamı unuttum" → POST /auth/forgot 200 + not · doğru parola → hesap görünümü | OK | 851 ms | 401 "E-posta ya da parola hatalı."; forgot 200 (token sha256 DB'de; bilinmeyen e-posta da 200); login 200 → hesap |
| e çıkış → reset önizlemesinden ?sifirla=<token> → sıfırlama dalı → yeni parola → 200 + anında giriş + flash notu | OK | 1268 ms | reset 200 → hesap görünümü; flash "Parolan güncellendi."; token tek kullanımlık (400); password-changed cmt1u9k0m004cwgr4aw2hjzc1 |
| f API: eski parola → 401, yeni parola → 200 (çerezler) · GET /auth/me · CSRF'siz PUT /me/address 403 | OK | 479 ms | 401/200; /auth/me ok; CSRF'siz PUT 403; adres null; consents KVKK_ACK=true,MARKETING_EMAIL=false |
| g uyelik adres formu (ilçe select: /delivery/zones, Urla) → PUT /me/address 200 → özet → GET /me/address zoneSlug urla | OK | 905 ms | id=cmt1u9km2004gwgr4g0pyfxpf zone=urla zip=35430; düzenleme aynı satırı güncelledi (zip boşaltıldı → null) |
| h sepet.html (oturumlu + sepette ürün): giriş kapısı açık, müşteri formu oturum/adresten dolu, teslimat adımı açılıyor | OK | 650 ms | formlar dolu (Urla); teslimat adımı açık; sepet sayacı "1" |
| h2 toptan.html (oturumlu müşteri): form → BahcedenCart.api → X-CSRF-Token → 201 (CSRF 403 yok) | OK | 771 ms | 201 + CSRF başlığı; lead cmt1u9m7f004jwgr4casd47hv; yönetici bildirimi yok (contactEmail/SMTP_FROM tanımsız) |
| i1 admin giriş → Müşteriler listesi: yeni kullanıcı (arama, rol rozeti, doğrulama "Doğrulandı", son giriş) | OK | 620 ms | liste satırı: Müşteri · Aktif · Doğrulandı; API total=1, lastLoginAt dolu |
| i2 müşteri detayı: profil + onaylar (KVKK Verildi / pazarlama Reddedildi) + adres + audit özeti · ad PATCH → API | OK | 229 ms | onaylar KVKK Verildi / pazarlama Reddedildi; adres + audit görünür; PATCH name="E2E Müşteri mt1u9frx"; self-deactivate 400 |
| i3 Anonimleştir (onay) → e-posta anon+id@anon.local, ad/telefon/adres silindi, isActive false, müşteri oturumu düştü (401) | OK | 744 ms | email=anon+cmt1u9h5h0041wgr4rfmep6kb@anon.local; adres 0; isActive=false; müşteri 401/401/401; tekrar 409 |
| j Sistem › E-posta günlüğü: test kullanıcısının 4 satırı (welcome/verify/reset/password-changed, Atlandı) · durum filtresi · API previewPath | OK | 114 ms | 4 satır SKIPPED (entityId=uid, previewPath dolu); SENT 0 |
| k Ayarlar › E-posta › "Test e-postası gönder" → SKIPPED + önizleme dosyası (MailLog mail.test) | OK | 202 ms | logId=cmt1u9nrx004nwgr4bx2p3x9w SKIPPED → cmt1u9nrx004nwgr4bx2p3x9w.html |
| l audit-logs: auth:REGISTER/PASSWORD_RESET (müşteri aktör), me:UPDATE (adres), customers:UPDATE/ANONYMIZE, settings (mail test); e-posta/parola sızmaz | OK | 9 ms | 13 satır: auth:LOGIN, auth:LOGOUT, auth:PASSWORD_RESET, auth:REGISTER, customers:ANONYMIZE, customers:UPDATE, me:UPDATE, settings:CREATE |
| m admin çıkış → /admin/customers 401 | OK | 109 ms | 401 doğru |
| tarayıcı konsolu (site/admin) | OK | 0 ms | site 1 · admin 2 hata: console: Failed to load resource: the server responded with a status of 401 (Unauthorized) \| console: Failed to load resource: the server responded with a status of 401 (Unauthorized) \| console: Failed to load resource: the server responded with a status of 401 (Unauthorized) |
| z temizlik: test kullanıcısı (consents/addresses/mail_logs/audit/users) · test e-postası satırları · önizleme dosyaları → sayımlar ≡ başlangıç | OK | 1239 ms | users=1 mail_logs=0 addresses=0 customers.total=1; 5 önizleme dosyası silindi |

Ekran görüntüleri: `tools/e2e-admin/out/f6-*.png`. DISABLE_MAIL=true: e-postalar gönderilmez, MailLog SKIPPED + `apps/api/logs/mail/<id>.html` önizlemesi (bağlantılar buradan okundu; temizlikte silindi). Sırlar çıktıya yazılmaz; admin kimliği ve DB bağlantısı apps/api/.env (SEED_ADMIN_*, DATABASE_URL).
