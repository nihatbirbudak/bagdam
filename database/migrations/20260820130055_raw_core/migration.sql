-- 0002_raw_core (ADR-0013): Prisma DSL ile ifade edilemeyen ham SQL.
-- Kullanıcı başına (silinmemiş) yalnız BİR varsayılan adres — kısmi benzersiz indeks (PostgreSQL 14+).
-- Kolon adları camelCase (şemada @map yok): "userId", "isDefault", "deletedAt".
CREATE UNIQUE INDEX "addresses_one_default" ON "addresses"("userId") WHERE "isDefault" AND "deletedAt" IS NULL;
