# Bağdam — güvenlik denetimi (F10)

> Kapsam: `apps/api` (REST + `.hbs` web), `apps/admin` (React SPA), `packages/shared`, `deploy/`.
> Kaynak kararlar: [ADR-0015](adr/0015-guvenlik-ve-repo.md) (güvenlik + KVKK), [ADR-0009](adr/0009-kimlik-ve-oturum.md) (oturum),
> [ADR-0019](adr/0019-odeme-saglayicisi-paytr.md) (PayTR), [ADR-0003](adr/0003-frontend-stratejisi.md) (inline bootstrap → CSP kısıtı).
> Doğrulama: `apps/api/src/__tests__/security/**` (jest, gerçek DB) + `tools/e2e-admin/run-f10.mjs` adım **n**.
> Son güncelleme: 2026-08-21 (F10 sonu, lokal).

Bu dosya **denetim özetidir**: ne korunuyor, nerede uygulanıyor, hangi testle kilitli, hangi risk açık.
Saklama süreleri ayrı dosyada: [kvkk-veri-saklama.md](kvkk-veri-saklama.md).

---

## 1. Kimlik, oturum, yetki

| Konu | Uygulama | Not |
|---|---|---|
| Oturum taşıyıcısı | `access_token` (JWT, 15 dk) + `refresh_token` (30 gün, rotasyonlu) — **httpOnly** çerez | `apps/api/src/config/cookie.config.ts`. `localStorage`'da token YOK (F9'da prototip anahtarları da temizlendi). |
| Çerez bayrakları | `httpOnly` · `sameSite=lax` · `secure` **yalnız production** · `path=/` (refresh: `/api/v1/auth`) | Dev http://127.0.0.1 için `secure=false`. `COOKIE_DOMAIN` opsiyonel. |
| CSRF | Double-submit: `csrf_token` çerezi (httpOnly:false) + `X-CSRF-Token` başlığı; `CsrfGuard` **access çerezi görünce** başlık arar | Çerezsiz (anonim) istekte aranmaz → `POST /consents`, `POST /wholesale-leads`, checkout misafir akışı çalışır. |
| Parola | bcrypt; sıfırlama token'ı sha256 özet, 60 dk, tek kullanımlık; sıfırlamada diğer oturumlar düşer | `AuthService`. |
| Oturum kilidi | **5 hatalı giriş → 30 dk kilit** (`MAX_FAILED_LOGIN_ATTEMPTS` / `LOCK_DURATION_MS`), başarılı girişte sayaç sıfır | `auth.service.ts`; `users.failedLoginAttempts` / `lockedUntil`. |
| Guard zinciri | `ThrottlerGuard` → `JwtAuthGuard` → `CsrfGuard` → `RolesGuard` (global, `app.module.ts`) | `@Public()` yalnız kasıtlı uçlarda; varsayılan **kapalı**. |
| Roller | `ADMIN` · `STAFF` · `CUSTOMER` | Panel uçları `@Roles('ADMIN','STAFF')`; yıkıcı/parasal olanlar yalnız `ADMIN`. |

### Uç nokta yetki matrisi

| Yüzey | Uç (özet) | Erişim |
|---|---|---|
| Web sayfaları | `WebController` (10 `.hbs`, `/sitemap.xml`, `/robots.txt`) | **Public** |
| Katalog | `GET /bootstrap`, `/products`, `/tiers`, `/box-week`, `/categories`, `/producers` | **Public** (salt okunur) |
| İçerik | `GET /site-content`, `/posts`, `/legal/*`; `POST /consents` | **Public** (POST /consents 20/dk/IP) |
| Teslimat | `GET /delivery/zones`, `/delivery/dates` | **Public** |
| Toptan | `POST /wholesale-leads` | **Public** (3/dk/IP) |
| Checkout | `POST /checkout/quote`, `POST /checkout` | **Public** (misafir + üye; 60/dk ve 10/dk) |
| Ödeme dönüşü | `GET /pay/:linkToken` | **Public** (token bilgisi = yetki) |
| PayTR bildirimi | `POST /payments/paytr/callback` | **Public + `@SkipCsrf` + `@SkipThrottle`** — IP allowlist + HMAC hash + `WebhookEvent` idempotency |
| Hesap | `/me/*` (adres, siparişler, kartlar, onaylar), `/me/subscription/*` | **CUSTOMER** (kendi kaydı; sahiplik serviste kontrol edilir) |
| Sipariş (müşteri) | `GET /orders/:orderNo` | **CUSTOMER** — başkasının siparişi **404** |
| Panel (okuma+ops) | `/admin/{products,lots,images,categories,producers,tiers,box-templates,box-week,site-content,posts,legal,settings,delivery,customers,orders,subscriptions,cycles,ops,payment-issues,dashboard,mail-logs,audit-logs,system-logs,cron-logs,webhook-events,health/detailed,wholesale-leads,media}` | **ADMIN + STAFF** |
| Panel (yalnız ADMIN) | `POST /admin/subscriptions` (manuel checkout) · `/admin/payments/*` (iade) · `/admin/coupons` mutasyonları · `/admin/jobs/*` · `/admin/customers/:id/anonymize` · `GET /admin/audit-logs` | **ADMIN** |
| Sağlık | `GET /health` | **Public** (sır içermez); ayrıntılı sürüm panelde |

**e2e doğrulaması (adım n):** 6 admin ucu oturumsuz **401**; müşteri hesabıyla `/admin/*` **403**; başka kullanıcının siparişi **404**.

---

## 2. Güvenlik başlıkları ve CSP

Tek kaynak: `apps/api/src/common/security/{security-headers,content-security-policy}.ts` — `main.ts` **ve** güvenlik testleri
aynı `applySecurityHeaders()` fonksiyonunu çağırır, yani testte doğrulanan başlık üretimdekiyle aynıdır.

| Yol | CSP |
|---|---|
| **web** (`.hbs`, statikler) | `default-src 'self'; script-src 'self' 'unsafe-inline' https://www.paytr.com; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src https://www.paytr.com; form-action 'self' https://www.paytr.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; manifest-src 'self'; worker-src 'self' blob:` |
| **admin** (`/app/*`) | inline script yok; `frame-ancestors 'none'` |
| **api** (`/api/*`) | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |

- `'unsafe-inline'` script için **zorunlu**: ADR-0003 inline bootstrap (`partials/bootstrap.hbs`) ve sayfa betikleri şablonun içindedir.
  Bunun bedeli §5'teki depolanmış XSS riskidir; karşı önlem sunucu tarafı temizleyici.
- `font-src 'self' data:` **zorunlu**: `public/styles.css` 7 fontu `data:font/woff2;base64` olarak gömüyor (B'nin bulgusu — `data:` olmadan Chromium fontları blokluyordu, **parite kırılıyordu**).
- `img-src data:` : prototipte gömülü küçük görseller.
- **HSTS yalnız production** (1 yıl + includeSubDomains); lokal `http://127.0.0.1` tarayıcıda HTTPS'e kilitlenmesin.
- `X-Powered-By` kapalı (`app.disable`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- COEP/CORP **kapalı** — PayTR iFrame'i ve panelin API origin'inden görsel çekmesi için (ADR-0019).

**e2e doğrulaması (adım n):** web CSP'sinde `frame-src https://www.paytr.com` + `script-src … 'unsafe-inline'` + `img-src … data:` + `font-src … data:` + `frame-ancestors 'none'`; api CSP'sinde `default-src 'none'`; dev'de HSTS **yok**; `X-Powered-By` **yok**.

---

## 3. Hız sınırları (rate limit)

Global: **100 istek / dk / IP** (`ThrottlerModule`, `app.module.ts`). Uç bazlı sıkılaştırmalar:

| Uç | Sınır | Gerekçe |
|---|---|---|
| `POST /auth/register` | 5/dk | hesap yağması |
| `POST /auth/login` | 10/dk | kaba kuvvet (ayrıca 5 hata → 30 dk kilit) |
| `POST /auth/forgot-password` | 3/dk | e-posta bombardımanı + hesap sayımı |
| `POST /auth/reset-password` | 5/dk | token deneme |
| `GET /auth/verify`, `GET /auth/csrf` | 30/dk | normal gezinme |
| `POST /auth/change-password` | 5/dk | — |
| `POST /checkout/quote` | 60/dk | sepet her değişimde fiyat sorar |
| `POST /checkout` | 10/dk | sipariş yağması |
| `POST /consents` | 20/dk | çerez şeridi kategori başına bir istek atar |
| `POST /wholesale-leads` | 3/dk | form spam'i |
| `POST /admin/settings/mail/test` | 10/dk | e-posta relay kötüye kullanımı |
| `POST /payments/paytr/callback` | **`@SkipThrottle`** | sağlayıcı yeniden dener; bloklamak ödemeyi kaybettirir. Koruma: IP allowlist + hash + idempotency. nginx tarafında da limit dışı bırakılacak (F10b). |

> **Not (staging/prod):** Cloudflare arkasında IP `X-Forwarded-For`'dan okunur (`trust proxy` tek hop). WAF'ta
> `/api/v1/payments/*/callback` ve `/pay/*` istisna listesine alınmalı (F10b vhost işi).

---

## 4. Sır yönetimi

| Sır | Nerede | Koruma |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | `.env` (yalnız sunucu, 600) | production'da **≥32 karakter** zorunlu; `CHANGE_ME`/`dev-secret` gibi zayıf değerler **süreç başlatmaz** (`env-validator.ts`) |
| `SETTINGS_ENCRYPTION_KEY` | `.env` | AES-256-GCM; ≥32 karakter zorunlu |
| PayTR `merchant_key` / `merchant_salt` | `settings` tablosu, `enc:v1:` önekiyle **şifreli**; yoksa `.env PAYTR_*` | `GET /admin/settings/payment` **maskeli** döner (`••••`, `isSecret`+`hasValue`); ham değer ve `enc:v1:` yanıta **hiç girmez** |
| SMTP parolası | aynı (`settings` `mail.pass`) | aynı |
| DB parolası | `DATABASE_URL` (.env) | log/hata mesajına yazılmaz (`sql()` yardımcıları bile bağlantı dizesini gizler) |
| Repo | public monorepo | `.env*` gitignore'lu; `docs/sunucu-baglanti.md` gitignore'lu; GitHub secret scanning + push protection **kullanıcı aksiyonu** |

`env-validator` production zorunluları: `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`(32), `JWT_REFRESH_SECRET`(32),
`SETTINGS_ENCRYPTION_KEY`(32), `WEB_URL` (mutlak, https bekleniyor), `ADMIN_URL` (mutlak);
`PAYTR_*` verildiyse üçü birlikte + `PAYTR_TEST_MODE` 0/1; `ALLOW_JOB_TIME_OVERRIDE` production'da **yasak**;
`DISABLE_MAIL=true` production'da uyarı.

**e2e doğrulaması (adım n):** sır yazılır → `GET` maskeli döner, yanıtta `enc:v1:` yok, DB'de şifreli.

---

## 5. Girdi güvenliği (enjeksiyon / XSS / kütle atama)

| Sınıf | Durum | Uygulama |
|---|---|---|
| SQL enjeksiyonu | **Kapalı** | Prisma parametrik; ham SQL yalnız migration'da. `__tests__/security/csrf-injection-xss.spec.ts` 4 klasik yükü sorgu/gövde alanlarına basar. |
| Kütle atama | **Kapalı** | Global `ValidationPipe` `whitelist + forbidNonWhitelisted` → DTO dışı alan **400** (`property X should not exist`). |
| Yansıyan XSS | **Kapalı** | Sunucu tarafı `escapeHtml` (`&<>"`); `{{{ }}}` yalnız ÖNCEDEN kaçışlanmış değerlerle kullanılır (parite kuralı, `web/content-view.ts`). |
| Inline bootstrap JSON | **Kapalı** | `toScriptJson`: `<`→`<`, `</script>`, `<!--`, U+2028/29 kaçışlı. |
| **Depolanmış XSS (CMS richtext)** | **F10'da kapatıldı** | `common/security/html-sanitize.ts` — reddeden (deny-list) temizleyici: `<script|iframe|object|applet|frameset>` gövdesiyle silinir, `<base|link|meta|embed|frame>` etiketi silinir, `on…=` olay nitelikleri ve `srcdoc/formaction/xlink:href` düşer, `javascript:`/`vbscript:`/görsel olmayan `data:` bağlantıları `#` olur. **İki yerde**: yazma (`ContentAdminService`: site-content richtext, Post `titleHtml/bodyHtml`, LegalDocument `leadHtml/bodyHtml`) + render (`web/content-view.ts`, `escapeContentValue`). Temiz içerik **byte-byte aynı** kalır → parite bozulmaz (DB'deki 315 HTML dizesinde 0 değişiklik ölçüldü). Test: `__tests__/security/richtext-sanitize.spec.ts` (13 test). |
| URL alanları (CMS `url`/`image`) | **Kapalı** | `javascript:`/`data:`/`vbscript:` şeması **400** (`site-content.schema.ts`). |
| Dosya yükleme | **Kapalı** | multer MemoryStorage, **20 MB**, tek dosya, mime allowlist (`jpeg/png/webp/gif/avif/tiff`); sharp ile yeniden kodlama (en çok **2000 px**, çıktı hep `webp`) → EXIF ve gömülü betik düşer. Yol dışına yazma yok (ad sunucuda üretilir). |
| Handlebars şablonları | Derleme kontrolü | `node tools/hbs-check.mjs` → 19/19 şablon derleniyor, eksik partial referansı yok. |

---

## 6. PII ve günlükler

- **Redaksiyon tek yerde:** `common/security/redaction.ts` — `redactObject` (AuditLog `oldValues/newValues`, WebhookEvent `payload`),
  `redactUrl` (log satırındaki `?token=`, `?to=`), `maskEmail`/`maskPhone`. Hassas anahtar listesi: parola/token/secret/apiKey/
  authorization/cookie + kart alanları + e-posta/telefon/adres/TCKN alanları.
- **AuditLog** append-only: satır asla silinmez; `privacy.auditPiiMonths` (varsayılan **12 ay**) sonrası PII alanları `kvkk:purge`
  ile `[silindi]` olur (`[redacted]` yazma anında, `[silindi]` saklama süresi dolduğunda — ayrımı bilerek).
- **SystemLog** yalnız 5xx + servis hataları (`AllExceptionsFilter` → `SystemLogsService`), 30 gün.
- **MailLog** alıcı adresi + konu + durum, 90 gün; `DISABLE_MAIL` önizleme dosyaları satırla birlikte diskten silinir.
- Ayrıntılı matris: [kvkk-veri-saklama.md](kvkk-veri-saklama.md).

**e2e doğrulaması (adım l):** 400 gün önceki AuditLog satırı → `actorEmail`/`ipAddress`/`summary`/`newValues` PII'si `[silindi]`,
PII olmayan alan **korunur**, satır **silinmez**; eski MailLog/SystemLog/CronLog satırları (+ önizleme dosyası) silinir; taze satırlar durur.

---

## 7. Hata zarfı

`AllExceptionsFilter` → `{statusCode, code, message, error, requestId, timestamp, path}`.
`code` **her zaman** `[A-Z][A-Z0-9_]*` biçiminde makine kodudur (F8 açık notu kapandı): istemci `code`'a göre dallanır,
`message` yalnız kullanıcıya gösterilir. Örnek: `CSRF_INVALID`, `CONSENT_REQUIRED`, `DAY_FULL`, `ORDER_TRANSITION_INVALID`,
`BOX_TEMPLATE_MISSING`, `LEGAL_CURRENT_LOCKED`, `PAYMENT_PROVIDER_UNAVAILABLE`, `JOB_NOW_OVERRIDE_FORBIDDEN`.
5xx gövdesinde yığın izi / iç hata metni **yok** (yalnız `requestId` ile log'a bağlanır).

---

## 8. Bağımlılık uyarıları (`pnpm audit`, 2026-08-21)

`3 vulnerabilities found · Severity: 3 high`

| Paket | Sürüm | Yol | Değerlendirme |
|---|---|---|---|
| `sharp` | 0.34.5 (<0.35.0) | `apps/api > sharp` — **çalışma zamanı** | libvips CVE-2026-33327/33328/35590/35591. Etki yüzeyi: yalnız **panel medya yükleme** (ADMIN/STAFF, 20 MB, mime allowlist). Anonim kullanıcı sharp'a girdi veremez. **Aksiyon: F10b öncesi `sharp@^0.35` yükseltmesi** (bu görevde `pnpm add` yasak). |
| `deepmerge-ts` | 7.1.5 (<8.0.0) | `@prisma/client > prisma > @prisma/config` — **CLI/geliştirme** | Yığın tükenmesi; yalnız Prisma CLI (migrate/generate) yolunda, üretim çalışma zamanında yüklenmez. Prisma sürüm yükseltmesiyle gelir. |
| `effect` | 3.18.4 (<3.20.0) | aynı (`@prisma/config`) | AsyncLocalStorage bağlam kaybı; aynı gerekçeyle üretim dışı. |

> Yükseltmeler `pnpm add`/`pnpm up` gerektirdiği için bu görevin kapsamı dışında bırakıldı (görev kuralı).
> **F10b/F11 kontrol listesine yazıldı** (`docs/RUNBOOK.md` → Lansman kontrol listesi).

---

## 9. Test kapsamı

`apps/api/src/__tests__/security/` (jest, gerçek DB, geçici aktörler sonda silinir):

| Dosya | Kapsam |
|---|---|
| `access-matrix.spec.ts` | public / customer / staff / admin uç matrisi + IDOR (başkasının siparişi/aboneliği) |
| `csrf-injection-xss.spec.ts` | CSRF double-submit, kütle atama whitelist, SQL enjeksiyon yükleri, inline bootstrap JSON kaçışı |
| `richtext-sanitize.spec.ts` | **F10 D:** CMS zengin metin temizleyici — temiz içerik değişmez, betik yapıları düşer, idempotent, geri izleme patlaması yok |
| `headers-and-envelope.spec.ts` | üç CSP politikası, HSTS/X-Powered-By/X-Frame-Options, hata zarfı `code` alanı |
| `secrets-and-upload.spec.ts` | yanıtlarda sır sızıntısı yok; dosya yükleme mime/boyut/piksel sınırları |
| `env-validator.spec.ts` | production zorunluları, zayıf sır reddi, PayTR üçlüsü |
| `zz-rate-limit.spec.ts` | hız sınırı (en sona alınır — diğer suite'lerin sayaçlarını bozmasın) |
| `cookie/cookie-consent.spec.ts` | çerez şeridi sözleşmesi (sunucuda gizli, kapalı kategori basılmaz, Consent yazılır) |

Uçtan uca: `tools/e2e-admin/run-f10.mjs` adım **n** (oturumsuz 401 · IDOR · CSRF · CSP + PayTR `frame-src` · sır maskesi).

---

## 10. Açık riskler ve devreden maddeler

| # | Konu | Şiddet | Durum |
|---|---|---|---|
| 1 | `sharp` 0.34.5 libvips CVE'leri | Orta (yetkili yüzey) | **F10b:** `pnpm --filter @bagdam/api add sharp@^0.35` + medya duman testi |
| 2 | `script-src-attr 'none'` ile PayTR `checkoutFormContent` dalı | Düşük | Şu an kullanılan yol `redirectUrl`/`token` (iFrame) → etkisiz. **PayTR sandbox provasında (F10b/F11) doğrulanmalı**; sağlayıcı HTML'i inline `onclick=` kullanırsa `script-src-attr 'unsafe-inline'` gerekir. |
| 3 | nginx `location /app/` eksik (admin Vite çıktısı `dist/app/*`) | Düşük (performans + cache) | `deploy/nginx/admin.bagdam.com.conf` — **F10b** (C'nin notu; `deploy/` bu görevin yazma kapsamı dışıydı) |
| 4 | WAF/nginx hız sınırı istisnaları (`/payments/*/callback`, `/pay/*`) | Orta (ödeme kaybı) | **F10b** vhost + Cloudflare kuralı |
| 5 | Gerçek PayTR sandbox provası (3DS + kart saklama + iade) | — | **F10b/F11**, mağaza bilgisi kullanıcıdan bekleniyor |
| 6 | `payment.storedCardEnabled` / `nonThreeDsGranted` | — | PayTR yazılı teyidine kadar **kapalı** → abonelik tahsilatı `PAYMENT_LINK` |
| 7 | GitHub secret scanning + push protection | Düşük | **Kullanıcı aksiyonu** (public repo) |
| 8 | 2FA / OTP (panel) | Düşük | ADR-0016 P2 — lansman kapsamı dışı |
| 9 | `DELETE /auth/me` (KVKK silme talebi) UI'sı yok | Düşük | Şema var, anonimleştirme yalnız panelden (ekran 16). P2. |
| 10 | Otomatik bağımlılık taraması (CI) | Düşük | `pnpm audit` elle koşuluyor; CI adımı F10b'de `deploy.yml`'e eklenebilir |
