# ADR-0013: Şema iki parça (F2a/F2b), dondurma F10, additive migration

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Karar:** F2a (kullanıcı/adres/bölge/teslimat tarihi/katalog/parti/kutu şablonu/içerik/yasal/ayar/medya/log) F2'de; F2b (sipariş/ödeme/abonelik/cycle) F7'nin 1. günü tasarım spike'ıyla. Migration zinciri: `0000_extensions` (citext) → `0001_init_core` → `0002_raw_core` → `0003_commerce` → `0004_raw_commerce`. Lansmana kadar `migrate dev` serbest (müşteri verisi yok) ama **squash yok** (staging/prod'da admin içeriği birikir); F10'da "şema v1 donduruldu" ADR'ı, sonrası yalnız additive. "Şema-var/UI-yok" alanlar (Cart, billing*, PAUSED, Address.isDefault, Producer.story/photo) yorumla etiketli; admin formu/efor ayrılmaz.
