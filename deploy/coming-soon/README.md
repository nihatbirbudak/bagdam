# Coming-soon sayfaları — bagdam.com + bahcedenal.com.tr (geçici yayın, 2026-08-20)

> Amaç: tam site (F10b/F11) hazır olana kadar `bagdam.com`'da marka tasarımıyla "yakında" sayfası;
> `bahcedenal.com.tr`'de aynı sayfanın **"Bahçeden Al artık Bağdam"** notlu sürümü. Statik dosya + nginx;
> API/PM2 yok. Kaynak tasarım: `apps/api/views/coming-soon.hbs` (ADR-0003 istisna 6, ADR-0012).

## Dosyalar

| Repo | Sunucu | Ne |
|---|---|---|
| `bagdam.com/index.html`, `robots.txt` | `/var/www/bagdam-comingsoon/` | bagdam.com sayfası (coming-soon.hbs'in statik kopyası) |
| `bahcedenal.com.tr/index.html`, `robots.txt` | `/var/www/bahcedenal-comingsoon/` | "artık Bağdam" sürümü (canonical www.bahcedenal.com.tr, Organization `alternateName: Bahçeden Al`) |
| *(publish.sh kopyalar)* `apps/api/public/{styles.css, assets/logo/*, assets/images/hero-crate.jpg, assets/icons/{mutlu-musteri,konum}.png}` | her iki dizinde `styles.css` + `assets/` | sayfanın kullandığı ortak dosyalar |
| `nginx/bagdam.com.coming-soon.conf` | `/etc/nginx/sites-available/bagdam.com.conf` (+ `sites-enabled`) | **geçici** apex vhost — 80→https, www→apex 301, `/`=200, `/assets/`+`/styles.css` statik, diğer yollar 302→/ |
| `nginx/bahcedenal.com.tr.conf` | `/etc/nginx/sites-available/bahcedenal.com.tr` | bahcedenal vhost'unun güncel hâli (eski kurallar + `/assets/`, `/styles.css` location'ları) |
| `publish.sh` | — | yerelden yükleme: `bash deploy/coming-soon/publish.sh [bagdam\|bahcedenal\|all]` (tar\|ssh; `ssh bagdam` alias'ı) |

Sunucu yedekleri (dokunma): `/var/www/bahcedenal-comingsoon.yedek-20260820/` (eski Bahçeden Al sayfası),
`/etc/nginx/sites-available/bahcedenal.com.tr.bak-20260820` (eski vhost).

## Yapılanlar (2026-08-20, `ssh bagdam` + `/root/cf-api.sh`)

1. Cloudflare `bagdam.com` zone: `A @ → sunucu (proxied)`, `CNAME www → bagdam.com (proxied)`; SSL **Full (strict)**, **Always Use HTTPS**, min TLS **1.2**. (Değerler gitignore'lu `docs/sunucu-cloudflare.md`.)
2. Let's Encrypt: `certbot certonly --webroot -w /var/www/letsencrypt -d bagdam.com -d www.bagdam.com` → `/etc/letsencrypt/live/bagdam.com/` (bitiş 2026-11-18; `certbot.timer` + deploy-hook `systemctl reload nginx`). HTTP-01 Cloudflare proxy'si arkasında çalıştı (80 vhost'unda ACME location).
3. `snippets/bagdam-security-headers.conf` sunucuya kuruldu (`deploy/nginx/snippets/`); geçici apex vhost aktif.
4. bahcedenal.com.tr: sayfa değiştirildi, vhost'a `/assets/` + `/styles.css` eklendi (eski `location / { return 302 /; }` her şeyi yönlendiriyordu), Cloudflare cache purge.
5. Doğrulama: `https://bagdam.com/` 200 · `http://` → 301 · `www` → 301 apex · `/styles.css`, `/assets/**` 200 · `/xyz` 302→/ · `/.env` 403; `https://www.bahcedenal.com.tr/` 200 (yeni içerik), eski derin URL 302→/ korunuyor; origin doğrudan (`--resolve`) 200.

## Güncelleme

Metin/tasarım değişince: ilgili `index.html`'i düzenle → `bash deploy/coming-soon/publish.sh all` → gerekirse purge
(`/root/cf-api.sh POST /zones/<zone>/purge_cache '{"purge_everything":true}'`; `index.html` zaten `no-cache`, `styles.css` 1 saat).
`coming-soon.hbs` değişirse `bagdam.com/index.html`'i yeniden kopyala (`cp apps/api/views/coming-soon.hbs deploy/coming-soon/bagdam.com/index.html`).

## Sıradaki adımlar (kullanıcı kararıyla)

- **bahcedenal.com.tr → bagdam.com yönlendirmesi** (kullanıcı "yakında" dedi): `nginx/bahcedenal.com.tr.conf` içindeki
  `location = /` + `location /` bloklarını `location / { return 301 https://bagdam.com$request_uri; }` ile değiştir
  (ACME location'ı ve sertifika kalsın) → `nginx -t && systemctl reload nginx`. Search Console'da her iki mülk de doğrulanmış olsun;
  eski ürün URL'leri için ileride yeni slug'lara 301 map (bahcedenal `seo-snapshot/`, 131 URL).
- **F10b sunucu kurulumu**: `deploy/README.md` §7 geçici `bagdam.com.conf`'un üzerine yazar — önce Origin CA (§6) hazır olmalı.
  `/var/www/bagdam-comingsoon` ve LE sertifikası zararsız; tam siteye geçince silinebilir (LE yenilemesi 80 vhost'undaki ACME location'a bağlı —
  tam vhost'ta da `/.well-known/acme-challenge/` varsa sorun yok, yoksa `certbot delete --cert-name bagdam.com`).
- E-posta (MX/SPF/DKIM/DMARC) henüz yok — sağlayıcı seçilince DNS-only kayıtlar eklenecek (F6/F10b).
