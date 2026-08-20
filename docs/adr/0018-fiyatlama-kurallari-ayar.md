# ADR-0018: Fiyatlama kuralları kodda sabit değil, admin'den değişen Setting

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi (ADR-0005 / ADR-0007'nin kargo eşiği, indirim yuvarlaması ve "abone" kargo kurallarını **parametreleştirir**; ADR'ler geçerli kalır, değerler Setting'den okunur)
- **Bağlam:** SISTEM-DURUMU "açık ürün kararları" kuyruğunda üç fiyatlama kuralı bekliyordu (eşik ≥ mi > mi; 649 → 324,50 mi 325 mi; aktif abonenin tekil ürün siparişinde kargo 0 mı zone kuralı mı). Kullanıcı kararı: bunlar sabit kod kararı değil, **işletmenin panelden değiştirebileceği ayarlar** olsun; varsayılan mevcut test davranışı.
- **Karar:** Üç kural `Setting` (grup `commerce`, `isSecret: false`) anahtarı olur ve `packages/shared/pricing` bunları `PricingContext.rules` (`PricingRules` = `Pick<CommerceSettings, …>`) ile parametre olarak okur:
  | Anahtar | Değerler | Varsayılan | Etki |
  |---|---|---|---|
  | `commerce.freeShippingRule` | `"gte"` \| `"gt"` | `gte` | `subtotalAfterDiscount ≥ zone.freeThreshold` (gte) ya da `>` (gt) → kargo 0. Eşik/ücret değeri yine yalnız DeliveryZone'da (ADR-0005 [B11]). |
  | `commerce.discountRounding` | `"kurus"` \| `"tl"` | `kurus` | İlk-2-kutu / retention indirim tutarı: kuruş (649 × %50 = 324,50) ya da tam TL (`Math.round` → 325, prototip cart.js). |
  | `commerce.subscriberFreeShipping` | boolean | `true` | Aktif abonesi olan müşterinin **tekil ürün (SINGLE)** siparişinde kargo 0 (true) ya da bölge kuralı (false). Abonelik siparişinin kendisinde kargo her zaman 0. |
  Çağıran (api PricingService F7, admin önizleme) DB'den çözdüğü `CommerceSettings`'i `ctx.rules` ile verir; vermezse ya da değer bozuksa varsayılan (`DEFAULT_PRICING_RULES`, `resolvePricingRules`) — mevcut çağrılar ve 103 test aynı sonucu verir. Seed `COMMERCE_SETTINGS_DEFAULTS`'tan üretildiği için üç anahtar create-only seed ile mevcut DB'ye de gelir.
- **Admin:** F5 **Ayarlar › Kampanya/Bölgeler** (BACKEND-PLANI ekran 14a, generic `commerce.*` grup formu): üç alan select/checkbox olarak; etiketler `FREE_SHIPPING_RULE_LABELS` / `DISCOUNT_ROUNDING_LABELS` (shared). Bootstrap `commerce` bloğuna `BootstrapCommerce ⊃ CommerceSettings` üzerinden otomatik gider (F9'da sepet metni "1000 TL ve üzeri / üzeri" buradan).
- **Sonuçlar:** Açık karar kuyruğundan üç madde düşer (kalan: kupon sistemi MVP'ye alınsın mı). Kural değişikliği mevcut Order snapshot'larını etkilemez (fiyatlama sipariş anında donar). Testler her kural için iki modu kapsar (`shipping/discounts/money/pricing/rules.test.ts`).
