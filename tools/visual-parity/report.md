# Görsel parite raporu — eski statik site vs Nest render (F3 temel; F5 CMS; F6 auth: --mask ile ADR-0003 istisna blokları)

- Tarih: 2026-08-21T08:49:49.952Z · Sabit sayfa saati (Date.now): 2026-08-21T08:49:49.849Z
- Eski: `http://127.0.0.1:8080` · Yeni: `http://127.0.0.1:4010`
- Araç: Playwright Chromium (headless, DSF 1, reducedMotion: reduce, animasyon/geçiş CSS ile kapalı, `document.fonts.ready` + networkidle + sona kadar kaydırma) · pixelmatch threshold 0.1, includeAA false
- Kabul: fark piksel oranı ≤ %0.1 (tam sayfa; boyut farkında küçük görüntü beyaz zeminle büyütülür)
- Çıktılar: `tools/visual-parity/out/<sayfa>--<viewport>--{old,new,diff}.png` (gitignore)
- Maske (--mask): `#forgotNote,#cookieConsent` — bu seçicilerle eşleşen öğeler iki tarafta da ekran görüntüsünden önce akıştan çıkarıldı (display:none); fark yalnız maske DIŞI alanı ölçer.

## Görsel karşılaştırma — 30 çift, 30 OK / 0 FAIL

| Sayfa | Yol | Viewport | Eski boyut | Yeni boyut | Fark px | Fark % | Sonuç |
|---|---|---|---|---|---:|---:|---|
| index | `/index.html` | mobile-390 | 396×3875 | 396×3875 | 0 | 0.0000 | OK |
| index | `/index.html` | tablet-820 | 826×5061 | 826×5061 | 0 | 0.0000 | OK |
| index | `/index.html` | desktop-1440 | 1440×4745 | 1440×4745 | 0 | 0.0000 | OK |
| urunler | `/urunler.html` | mobile-390 | 390×1152 | 390×1152 | 0 | 0.0000 | OK |
| urunler | `/urunler.html` | tablet-820 | 820×1457 | 820×1457 | 0 | 0.0000 | OK |
| urunler | `/urunler.html` | desktop-1440 | 1440×1507 | 1440×1507 | 0 | 0.0000 | OK |
| urun | `/urun.html` | mobile-390 | 390×1056 | 390×1056 | 0 | 0.0000 | OK |
| urun | `/urun.html` | tablet-820 | 820×1180 | 820×1180 | 0 | 0.0000 | OK |
| urun | `/urun.html` | desktop-1440 | 1440×1391 | 1440×1391 | 0 | 0.0000 | OK |
| kutu | `/kutu.html?tier=sezon` | mobile-390 | 390×4016 | 390×4016 | 0 | 0.0000 | OK |
| kutu | `/kutu.html?tier=sezon` | tablet-820 | 820×4161 | 820×4161 | 0 | 0.0000 | OK |
| kutu | `/kutu.html?tier=sezon` | desktop-1440 | 1440×3522 | 1440×3522 | 0 | 0.0000 | OK |
| sepet | `/sepet.html` | mobile-390 | 390×844 | 390×844 | 0 | 0.0000 | OK |
| sepet | `/sepet.html` | tablet-820 | 820×1180 | 820×1180 | 0 | 0.0000 | OK |
| sepet | `/sepet.html` | desktop-1440 | 1440×956 | 1440×956 | 0 | 0.0000 | OK |
| uyelik | `/uyelik.html` | mobile-390 | 390×844 | 390×844 | 0 | 0.0000 | OK |
| uyelik | `/uyelik.html` | tablet-820 | 820×1180 | 820×1180 | 0 | 0.0000 | OK |
| uyelik | `/uyelik.html` | desktop-1440 | 1440×900 | 1440×900 | 0 | 0.0000 | OK |
| gunluk | `/gunluk.html` | mobile-390 | 390×4422 | 390×4422 | 0 | 0.0000 | OK |
| gunluk | `/gunluk.html` | tablet-820 | 820×4348 | 820×4348 | 0 | 0.0000 | OK |
| gunluk | `/gunluk.html` | desktop-1440 | 1440×4484 | 1440×4484 | 0 | 0.0000 | OK |
| toptan | `/toptan.html` | mobile-390 | 390×890 | 390×890 | 0 | 0.0000 | OK |
| toptan | `/toptan.html` | tablet-820 | 820×1180 | 820×1180 | 0 | 0.0000 | OK |
| toptan | `/toptan.html` | desktop-1440 | 1440×1060 | 1440×1060 | 0 | 0.0000 | OK |
| politikalar | `/politikalar.html` | mobile-390 | 390×1123 | 390×1123 | 0 | 0.0000 | OK |
| politikalar | `/politikalar.html` | tablet-820 | 820×1180 | 820×1180 | 0 | 0.0000 | OK |
| politikalar | `/politikalar.html` | desktop-1440 | 1440×1209 | 1440×1209 | 0 | 0.0000 | OK |
| nasil-seciyoruz | `/nasil-seciyoruz.html` | mobile-390 | 396×2849 | 396×2849 | 0 | 0.0000 | OK |
| nasil-seciyoruz | `/nasil-seciyoruz.html` | tablet-820 | 826×2868 | 826×2868 | 0 | 0.0000 | OK |
| nasil-seciyoruz | `/nasil-seciyoruz.html` | desktop-1440 | 1440×2621 | 1440×2621 | 0 | 0.0000 | OK |

## Sepet / kutu duman testi — 14 OK / 0 FAIL

Adımlar (her iki sitede, temiz context): `urun.html?id=incir` (fresh → "kutuda dene", sepete ekle yok) → `urun.html?id=ekmek` "+" → stepper / kayan sepet / localStorage → `kutu.html?tier=sezon` → #boxItems.

| Kontrol | Eski | Yeni | Aynı | Beklenen | Sonuç |
|---|---|---|---|---|---|
| urun?id=incir: CTA metni (fresh → "kutuda dene") | `"kutuda dene"` | `"kutuda dene"` | evet | evet | OK |
| urun?id=incir: data-add-to-cart yuva sayısı | `0` | `0` | evet | evet | OK |
| urun?id=ekmek: stepper sayacı | `"1"` | `"1"` | evet | evet | OK |
| urun?id=ekmek: kayan sepet sayacı | `"1"` | `"1"` | evet | evet | OK |
| localStorage bahceden_cart öğe sayısı | `1` | `1` | evet | evet | OK |
| localStorage bahceden_cart içerik | `[{"id":"ekmek","qty":1,"pref":null}]` | `[{"id":"ekmek","qty":1,"pref":null}]` | evet | evet | OK |
| kutu?tier=sezon: URL (yönlendirme yok) | `"/kutu.html?tier=sezon"` | `"/kutu.html?tier=sezon"` | evet | evet | OK |
| kutu: tier başlığı | `"10'lu Sezon Kutusu"` | `"10'lu Sezon Kutusu"` | evet | evet | OK |
| kutu: tier fiyatı | `"1099 TL / kutu"` | `"1099 TL / kutu"` | evet | evet | OK |
| kutu: #boxItems ürün sayısı | `10` | `10` | evet | evet | OK |
| kutu: #boxItems ürün adları | `["Bardacık İnciri","Urla Karası Üzüm","Pazı","Ata Tohumu Domates","Ata Tohumu Kavun","Acur` | `["Bardacık İnciri","Urla Karası Üzüm","Pazı","Ata Tohumu Domates","Ata Tohumu Kavun","Acur` | evet | evet | OK |
| kutu: bahceden_sub.items | `["incir","uzum","pazi","domates","kavun","acur","misir","biber","patlican","bamya"]` | `["incir","uzum","pazi","domates","kavun","acur","misir","biber","patlican","bamya"]` | evet | evet | OK |
| kutu: sepet sayacı korunuyor | `"1"` | `"1"` | evet | evet | OK |
| yeni: bahceden_sub.items ≡ __BAGDAM__.templates.sezon (eski: bootstrap yok) | `"bootstrap yok"` | `["incir","uzum","pazi","domates","kavun","acur","misir","biber","patlican","bamya"]` | evet | evet | OK |

