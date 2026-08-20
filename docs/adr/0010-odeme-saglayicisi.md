# ADR-0010: Ödeme: iyzico Checkout Form + kart saklama, PaymentProvider arayüzü

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi — "ilk sağlayıcı iyzico" kısmı yerini aldı: ADR-0019 (PayTR birincil); PaymentProvider arayüzü ve kart verisi kuralları geçerli
- **Bağlam:** Stripe TR'de yok; iyzico'nun sabit planlı abonelik ürünü değişken tutarlı kutuya oturmuyor; kart verisi bizde tutulmayacak.
- **Karar:** `PaymentProvider` arayüzü; ilk sağlayıcı iyzico (Checkout Form init/retrieve, registerCard, saklı karttan tahsilat, iade, webhook HMAC + `WebhookEvent` idempotency); `ManualProvider` testte; PayTR = P2. Kart verisi yalnız PSP token'ı (`PaymentMethod`). Callback `/sepet.html?siparis=<no>` (no-store). Fatura MVP'de manuel GİB e-Arşiv (`Order.invoiceNo/invoicePdfPath`); entegratör P2.
