# ADR-0021: Şema v1 donduruldu — bundan sonra yalnız additive migration

- **Tarih:** 2026-08-21
- **Durum:** Kabul edildi — ADR-0013'ün "F10'da şema v1 donduruldu ADR'ı" maddesini yerine getirir (ADR-0013 geçerliliğini korur)
- **Bağlam:** F10 sonunda şema tamam: `prisma migrate status` → **5 migration, "Database schema is up to date!"**; `database/schema.prisma` **37 model / 29 enum** (38 tablo + `_prisma_migrations`; 78 `timestamptz`, 0 naif `timestamp`; shared enum paritesi 29/29). Zincir: `20260820000000_extensions` (citext) → `20260820130020_init_core` → `20260820130055_raw_core` → `20260820183243_commerce` → `20260820183416_raw_commerce`. F8/F9/F10 şema değişikliği getirmedi (F10 yalnız `MailTemplateSlug` ve Setting `privacy.*` gibi **veri** ekledi; DDL yok). Lansmandan sonra staging/prod'da müşteri verisi ve admin içeriği birikecek → geri alınamayan DDL riski başlıyor.
- **Karar:**
  1. **Şema v1 dondurulmuştur.** Bundan sonra üretilen her migration **additive** olmalı: yeni tablo, yeni **nullable** kolon (ya da `DEFAULT`'lu NOT NULL), yeni index, yeni enum **değeri**, yeni FK.
  2. **Yeni ADR gerektiren değişiklikler:** kolon/tablo **silme**, **yeniden adlandırma**, tip daraltma, enum **değeri kaldırma**, `NOT NULL`'a çekme, unique kısıtı **ekleme** (mevcut veriyi kırabilir), FK `onDelete` davranışı değiştirme. Bu ADR'ın "Gerekçe + geri alma planı + veri taşıma adımları" bölümleri olmalı.
  3. **Squash yok.** `prisma migrate reset` yalnız lokal (`bagdam_dev`/`bagdam_test`); staging/prod'a yalnız `migrate deploy` (`deploy.sh`). `prisma db push` her ortamda yasak (ADR-0011/CLAUDE.md).
  4. **İki adımlı silme kuralı:** bir alan gerçekten kalkacaksa önce koddan kullanımı kaldırılır ve bir sürüm yayınlanır (alan DB'de durur), sonraki sürümde DDL ile düşürülür. Böylece geri alma (rollback) veri kaybetmez.
  5. **"Şema-var/UI-yok" alanlar korunur:** `carts`/`cart_items`, `orders.billing*`, `Subscription.PAUSED`, `Address.isDefault`, `Producer.story/photo`, `Consent.iysStatus` — kullanılmıyor diye **silinmez** (ADR-0013 kararı sürüyor); ileride UI'ları gelecek.
  6. Her deploy migration'dan **önce** `pg_dump` alır (`deploy.sh` zaten yapıyor); migration öncesi yedek 14 gün saklanır (`kvkk-veri-saklama.md` #18).
- **Sonuçlar:** Şema değişikliği artık "ucuz" değil — yeni alan istekleri önce additive çözümle karşılanır. `docs/erd.md` ve `packages/shared` enum'ları bu 37/29 sayımına kilitlidir; sapma CI'da `prisma validate` + shared enum paritesi testiyle yakalanır. Lansmandan sonraki ilk yıkıcı değişiklik ADR-0022 olacaktır.
