# ADR-0012: Yayın: apex lansmana kadar coming-soon, tam site staging'de

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Bağlam:** Sahte kart formu/checkout içeren prototip marka alan adında yayınlanmamalı; bagdam.com zone'u Cloudflare'de hazır, kayıt yok.
- **Karar:** F1'de `bagdam.com` = coming-soon (aynı tasarım, JSON-LD, robots allow); tam site yalnız `staging.bagdam.com` (basic auth, noindex). Apex tam siteye F11'de açılır. SSL = Cloudflare Origin CA wildcard (`/etc/ssl/bagdam/`), Full (strict), Always HTTPS, HSTS; WAF istisnası webhook/callback; Cache Rule `/api/*` bypass, `/assets/*` cache; Bot Fight Mode kapalı. A `@` + CNAME `www/admin/staging/admin-staging` proxied; MX/SPF/DKIM/DMARC DNS-only.
