# ADR-0004: Zaman: tüm an alanları timestamptz, TZ Europe/Istanbul, ham SQL'de now() yasak

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Bağlam:** Sunucuda PG oturum TZ Europe/Istanbul; Prisma varsayılan `timestamp` ile 3 saat kayma riski; kesim saatleri (12:00) kritik.
- **Karar:** Tüm an alanları `@db.Timestamptz(3)`; takvim günleri `@db.Date`. Ham SQL'de `now()/CURRENT_TIMESTAMP` yasak — JS `new Date()` parametre olarak bağlanır. PM2 `TZ=Europe/Istanbul`. Kesim hesabı `date-fns-tz` ile (`zonedTimeToUtc('…12:00','Europe/Istanbul')`). Testler hem `TZ=UTC` hem `TZ=Europe/Istanbul` altında koşar. Türkiye kalıcı +03 (DST yok) varsayılır.
