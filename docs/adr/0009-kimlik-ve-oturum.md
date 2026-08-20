# ADR-0009: Kimlik: e-posta + parola; cookie (web) ve Bearer (mobil) aynı JWT; telefon adres/siparişte

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Karar:** Kayıt e-posta + parola (bcrypt). Access JWT 15 dk + refresh 30 gün (rotasyon, hash'li). Web: httpOnly/Secure/SameSite=Lax cookie `access_token` `path=/`, `refresh_token` `path=/api/v1/auth`; CSRF double-submit; login 5 hata → 30 dk kilit; nginx login zone 3r/m. MVP'de Bearer yalnız testlerde; aynı JWT ileride mobil istemciler için `Authorization: Bearer` ile açılır (ek iş yok). Roller CUSTOMER/STAFF/ADMIN; admin uçları `/api/v1/admin/*` `@Roles`. Telefon `User`'da opsiyonel, `Address`/`Order`'da zorunlu. Misafir sepeti localStorage'da, checkout girişli. OTP/2FA = P2.
