# ADR-0005: Kesim kuralı, teslimat bölgesi ve kapasite

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Karar:** Kesim = teslimat gününden **1 gün önce 12:00** (tek kaynak `DeliveryDate.cutoffAt`; frontend'deki 23:59 kuralı kaldırılır). Teslimat günleri Salı/Perşembe/Cumartesi; `delivery-dates:generate` cron'u 8 hafta ileriyi üretir. Bölge = `DeliveryZone` (Urla, Çeşme — kendi kurye); kargo ücreti (49 TL) ve ücretsiz eşik (1000 TL) **yalnız** DeliveryZone'da tutulur. Kapasite alanı var, varsayılan 999 (fiilen sınırsız); ops günü kapatabilir; doluysa checkout 409 `DAY_FULL`. Kargo ücreti kuralı (PricingService tek kaynak, testli): abone ‖ zone eşik; değer yalnız `DeliveryZone.fee/freeThreshold`'dan. Şehir dışı kargo aracı (Geliver vb.) = P2.
