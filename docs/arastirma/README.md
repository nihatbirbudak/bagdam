# Bağdam — Backend araştırması (2026-08-20)

Bu klasör, [docs/BACKEND-PLANI.md](../BACKEND-PLANI.md) planını üreten çok ajanlı araştırmanın ham çıktılarını içerir. Plan tek başına okunup uygulanabilir; buradaki dosyalar kanıt ve gerekçe içindir.

> Sunucu IP/port gibi bilgiler repo public olduğu için `<…>` ile maskelenmiştir; gerçek değerler gitignore'lu `docs/sunucu-baglanti.md` dosyasındadır.

## Yöntem

| Faz | Ne yapıldı | Dosyalar |
|---|---|---|
| 1 — Anla | 4 ajan paralel: frontend satır satır envanteri; Türkiye ödeme/kargo/mevzuat/iletişim/abonelik gereksinimleri (web araştırması, kaynaklı); Uyanış Akademi (sunucudaki canlı NestJS+Prisma konvansiyonu); Bahçeden Al (Laravel/Next.js fork'u — kalıplar ve dersler) | 01–04 |
| 2 — Tasarla | 3 bağımsız mimar, farklı bakış açılarıyla tam plan yazdı; 3 hakem farklı merceklerle puanladı; sentez | 05–10 |
| 3 — Doğrula | 3 eleştirmen (eksiklik / sıra-rework / sunucu-uyum, SSH ile doğrulamalı) → 50 bulgu → düzeltme turu (v2) | 11 |

## Hakem sonucu

| Öneri | Toplam puan (3 hakem × 50) |
|---|---|
| A — MVP-önce | **125** (3/3 hakem kazanan seçti) |
| B — alan-doğruluğu | 109 |
| C — konvansiyon | 109 |

Eleştirmen bulguları: 3 kritik, 26 önemli, 21 küçük → 47'si plana işlendi, 3'ü gerekçeyle reddedildi/daraltıldı (plan §11–12).

## Dosyalar

- [01-frontend-envanteri.md](01-frontend-envanteri.md) — Bağdam frontend envanteri
- [02-turkiye-gereksinimleri.md](02-turkiye-gereksinimleri.md) — Türkiye'ye özgü sistem gereksinimleri (ödeme/kargo/mevzuat/iletişim/abonelik)
- [03-uyanisakademi-referansi.md](03-uyanisakademi-referansi.md) — Uyanış Akademi referansı (sunucunun canlı konvansiyonu)
- [04-bahcedenal-referansi.md](04-bahcedenal-referansi.md) — Bahçeden Al referansı (kalıplar ve dersler)
- [05-mimari-oneri-A-mvp-once.md](05-mimari-oneri-A-mvp-once.md) — Mimari öneri A — MVP-önce (KAZANAN)
- [06-mimari-oneri-B-alan-dogrulugu.md](06-mimari-oneri-B-alan-dogrulugu.md) — Mimari öneri B — alan-doğruluğu / risk-önce
- [07-mimari-oneri-C-konvansiyon.md](07-mimari-oneri-C-konvansiyon.md) — Mimari öneri C — konvansiyon / yeniden kullanım-önce
- [08-hakem-kapsam.md](08-hakem-kapsam.md) — Hakem raporu — kapsam & doğruluk merceği
- [09-hakem-sira.md](09-hakem-sira.md) — Hakem raporu — geliştirme sırası & rework merceği
- [10-hakem-ops.md](10-hakem-ops.md) — Hakem raporu — sunucu uyumu & operasyon merceği
- [11-elestirmen-bulgulari.md](11-elestirmen-bulgulari.md) — Eleştirmen hükümleri ve 50 bulgu tablosu
