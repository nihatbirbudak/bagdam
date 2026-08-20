# ADR-0017: Lokal-önce geliştirme — sunucu kurulumu ve yayın yalnız lansman öncesinde

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi (ADR-0012'nin "F1'de apex coming-soon" ve YOL-HARITASI F1 sunucu maddelerinin yerini alır)
- **Bağlam:** Kullanıcı kararı: site yeni; sunucuya geçmeden önce tüm özellikler lokalde uçtan uca çalışır hâle gelmeli (~%99). Erken sunucu/staging kurulumu bakım yükü ve dikkat dağıtır; kazancı yok.
- **Karar:** F1–F10 tamamen lokalde yapılır (API :4010, admin :4011, lokal PostgreSQL `bagdam_dev`). Sunucu kurulumu (Node 22, `/opt/bagdam`, DB'ler, nginx, Origin CA, Cloudflare DNS, CI anahtarı, yedek/health) ve apex "yakında" sayfası **tek bir adımda, F10 sonunda (F10b)** yapılır; ardından F11 lansman. GitHub'a push ve Actions deploy de bu adıma kadar gerekmez (repo lokal `main`'de ilerler; düzenli lokal commit).
- **Sonuçlar:** `deploy/` dosyaları hazır kalır, uygulanmaz. Playwright piksel-parite baseline'ı lokalde (http://127.0.0.1:4010) alınır. "Tek DB kuralı" zaten reddedilmişti (ADR-0011); lokal PG 18 kullanılır, PG 14 uyumu CI `postgres:14` kapısı yerine F10b öncesi sunucu-benzeri bir doğrulama (lokal PG 14 container/ikili veya sunucuda staging DB'ye tek seferlik `migrate deploy` provası) ile garanti edilir. Mevcut canlı bir site olmadığı için geçiş kesintisi riski yoktur.
