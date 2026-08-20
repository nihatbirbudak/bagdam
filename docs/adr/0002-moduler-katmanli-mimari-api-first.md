# ADR-0002: Modüler katmanlı mimari + API-first (web, admin ve ileride mobil aynı API'den beslenir)

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Bağlam:** Altyapı sade ve düzenli olmalı ki ürün artsın/azalsın, mobil gelsin, farklı sürümlere evrilsin; aynı yapılar tekrar yazılmasın.
- **Karar:** Klasik MVC veya 6 katmanlı clean-architecture DEĞİL; NestJS idiomu: **özellik modülü (dikey dilim) × 3 katman + ortak sözleşme paketi**.
  1. `apps/api/src/modules/<özellik>/` her biri aynı 5 dosya: `dto/` (class-validator giriş doğrulama), `*.controller.ts` (+ `*-admin.controller.ts`; HTTP/yetki/doğrulama, ince), `*.service.ts` (iş kuralları — tek doğruluk kaynağı), `*.repository.ts` (Prisma yalnız burada), `*.mapper.ts` (DB kaydı → DTO).
  2. `apps/api/src/common/` çapraz kesen: guard/filter/interceptor/prisma.service/config/audit/mail/pagination/yanıt zarfı.
  3. `packages/shared/`: enum'lar, DTO tipleri, durum makineleri (Order/Subscription/Cycle/Payment), fiyat hesabı — api, admin ve ileride mobil aynı dosyayı import eder.
  4. `database/`: Prisma şeması + migration'lar.
  5. İstemciler ince: `apps/api/src/web/` (.hbs sayfaları AYNI servislerle render eden WebController), `apps/admin` (SPA), ileride `apps/mobile`.
- **Kurallar:** Her şey `/api/v1` altından; WebController ve admin de aynı servisleri kullanır, kimse kendi hesabını yazmaz. Kimlik doğrulama aynı JWT ile cookie (web/admin) **veya** `Authorization: Bearer` — MVP'de Bearer yalnız testlerde; ileride mobil istemciler için ek iş olmadan açılır. Büyük kırılımda `/api/v2` yanına açılır. Müşteri/ticari kayıtlarda soft-delete (`deletedAt`) + `status`/`isActive` ile açma-kapama; fiziksel silme yalnız referanssız yardımcı varlıklarda (ör. MediaFile). Her modül için `PaymentProvider` gibi sağlayıcı arayüzleri (değişim = tek modül).
- **Yapmayacaklarımız:** interface/use-case/factory töreni, mikroservis, Redis, çoklu dil, multi-vendor. İhtiyaç olursa modül eklenir, temel değişmez.
