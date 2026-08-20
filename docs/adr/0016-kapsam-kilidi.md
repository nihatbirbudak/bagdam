# ADR-0016: Kapsam kilidi: MVP dışı (P2) liste ve karar kuyruğu ≤3

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Bağlam:** Bahçeden Al'da kapsam şişmesi + biriken açık kararlar projeyi kilitledi.
- **Karar:** P2 (lansman sonrası, ADR'sız eklenmez): temiz URL + 301, PayTR, kargo aracı (Geliver vb.) + Tr il/ilçe/mahalle tabloları, WhatsApp, e-Arşiv entegratörü, İYS API, abonelik pause, kupon UI, OTP/2FA, Invoice tablosu, çoklu adres UI, ayıplı ürün formu, üye sepeti merge (Cart), üretici sayfası. Yapmayacaklarımız (P2 bile değil): api-subdomain + localStorage admin token, Hyperlocal/Laravel kodu, multi-vendor/rider/wallet şemaları, Redis, çoklu dil. Açık ürün kararı kuyruğu en fazla 3; 4. karar geldiğinde biri kapatılmadan kod yazılmaz. "MVP'yi engellemez" listesi (6 vs 15 üretici, küratör adı, günlük metin çelişkileri, KDV oranı ürün bazlı, toptan form alanları) lansman sonrası.
