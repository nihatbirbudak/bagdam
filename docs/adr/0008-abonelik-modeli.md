# ADR-0008: Abonelik modeli: cycle-merkezli, içerik BoxTemplate'ten, tek seferlik kutu = isOneTime

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Karar:** `Subscription` → `SubscriptionCycle` (haftalık) → `CycleItem`. Cycle içeriği = admin'in yayınladığı `BoxTemplate` (tier × hafta); şablon yoksa cycle üretilmez + ops uyarısı. Swap/ekstra/pref yalnız o cycle'a; kalıcı olan yalnız `Subscription.itemPrefs`. Tek seferlik kutu = tek cycle'lı `Subscription(isOneTime)` → teslimde `COMPLETED`; aynı ekran ve uçlarla yönetilir. Aynı anda tek aktif abonelik (tek seferlik dahil). Canlı modda tier/type değişimi yok (UI butonları disabled); freq/gün/adres/kart PATCH ile. Fresh ürünler tekil satılmaz (yalnız kutu havuzunda). Ayıplı ürün telafisi MVP'de manuel: admin notu + iade veya 0 TL EXTRA satırı. Pause = şema-var/UI-yok (P2). Karışık sepet: `Order.kind` önceliği SUBSCRIPTION > BOX_ONE_TIME > SINGLE; `Order.customerEmail = User.email` (checkout'ta readonly).
