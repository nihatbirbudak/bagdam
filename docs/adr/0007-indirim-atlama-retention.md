# ADR-0007: İlk 2 kutu indirimi, haftayı atlama, iptal/retention kuralları

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Karar:** İlk 2 kutu %50: otomatik, üye başına 1 abonelik (`User.firstBoxesPromoUsedAt`), sipariş toplamına yansır (`Order.discountTotal`). Atlama: yılda 1 (`Setting skipsPerYear`), geri alınca hak iade edilir, sayaç `startedAt` yıl dönümünde sıfırlanır; atlanan hafta tahsil edilmez. İptal: `SubscriptionCancellation` 1:N (her akış bir satır; neden + metin); retention teklifi (%50, 1 kutu) üye başına 1 kez; fesih en geç 7 gün, iade en geç 15 gün (Abonelik Sözleşmeleri Yön. md.24-25). Kilitlenmiş cycle teslim edilir.
