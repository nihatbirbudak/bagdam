-- 0004_raw_commerce (ADR-0013): Prisma DSL ile ifade edilemeyen ham SQL (F7). Kolon adları camelCase (şemada @map yok) — tırnaklı.
-- 1) Sipariş numarası 1001'den başlar (Order.orderNo SERIAL → dizi "orders_orderNo_seq").
ALTER SEQUENCE "orders_orderNo_seq" RESTART WITH 1001;
-- 2) Aynı sağlayıcı ödeme kimliği yalnız BİR başarılı Payment satırında olabilir (webhook/callback çift teslimine karşı idempotency).
--    Kısmi benzersiz indeks (PostgreSQL 14+); NULL providerPaymentId ve diğer durumlar serbest.
CREATE UNIQUE INDEX "payments_provider_pid_succeeded" ON "payments"("provider", "providerPaymentId") WHERE "status" = 'SUCCEEDED';
