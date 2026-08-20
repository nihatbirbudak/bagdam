# ADR-0006: Tahsilat anı ve ikili tahsilat stratejisi

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Karar:** Abonelik cycle#1 checkout'ta peşin ödenir (3DS + kart saklama). Kesimden önce eklenen ekstralar ayrı küçük **DELTA Order** olarak tahsil edilir (ödenmiş Order değişmez). Sonraki cycle'lar kesimde (`cycles:lock-and-charge`, 5 dk cron, `FOR UPDATE SKIP LOCKED`). Strateji ikili: `MERCHANT_INITIATED` (iyzico saklı karttan NON3D) **veya** `PAYMENT_LINK` (3DS ödeme linki; `AWAITING_PAYMENT`, süre `paymentLinkHours 20`). Başarısız tahsilat: +24 s, +72 s yeniden deneme → `UNPAID` + atlandı; 2 ardışık → `PAST_DUE`. NON3D yetkisi F11'de "varsayılan strateji" kararıdır; yoksa PAYMENT_LINK ile lansman (ek geliştirme yok). cycle#1 atlanamaz.
