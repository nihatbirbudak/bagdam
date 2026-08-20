import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  computeCutoffAt,
  DEFAULT_TZ,
  deliveryDayForWeekday,
  deliveryDayFromSlug,
  isoDateToUtc,
  nextDeliveryDateFor,
  utcToIsoDate,
  weekdayOf,
  type DeliveryDatesGenerateResult,
  type DeliveryDay,
  type IsoDate,
} from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import { DeliveryRepository, type DateWithZoneRecord, type DbClient } from './delivery.repository';
import { DeliveryService } from './delivery.service';

/** Kilit kararı için yeterli alanlar (Prisma DeliveryDate ya da herhangi bir kısmi kayıt). */
export interface DeliveryDateLike {
  cutoffAt: Date;
  status: 'OPEN' | 'LOCKED' | 'CLOSED';
}

/** Doluluk kararı için yeterli alanlar. */
export interface DeliveryDateCapacityLike {
  reserved: number;
  capacity: number;
}

function prismaCode(err: unknown): string | null {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
}

/**
 * DeliveryDatesService (F7) — teslimat tarihi kesim/kapasite motoru (ADR-0005; state-machines §7 adım 5, §10; BACKEND-PLANI §5 F7).
 *  - `generate(weeks?, now?)`            → `DeliveryService.generateDates` (cron `delivery-dates:generate` 00:30; F5'te var, korunur).
 *  - `reserve(id, tx?)`                  → atomik `UPDATE … SET reserved = reserved + 1 WHERE id = $1 AND reserved < capacity AND status = 'OPEN'`;
 *                                          0 satır → 409 `DAY_FULL` (dolu) / 409 `DAY_CLOSED` (kapalı) / 404 `DELIVERY_DATE_NOT_FOUND`.
 *  - `release(id, tx?)`                  → reserved = max(reserved − 1, 0) (iptal / atlama / tahsil edilemedi); çağıran bir kez çağırır.
 *  - `findOrCreateFor(zoneId, date, tx?)` → (zone,date) satırı; yoksa Setting kesim kuralıyla oluşturur (capacity = bölge kapasitesi).
 *                                          Gün teslimat günü değilse (enum dışı ya da Setting `commerce.deliveryDays` dışı) 400 `NOT_DELIVERY_DAY`.
 *  - `nextFor(zoneId, day, after, tx?)`  → `after` anından sonra kesimi henüz geçmemiş ilk tarih (yoksa üretilir) — cart.js `nextDeliveryDate(dayId)`.
 *  - `isLocked(dd, now)`                 → `cutoffAt <= now` ya da status != OPEN (delivery.mapper `locked` ile AYNI kural). `isFull(dd)` → reserved >= capacity.
 * Zaman: `now`/`after` çağırandan Date; ham SQL yalnız repository'de ve yalnız sayaç için, now() yok (ADR-0004).
 */
@Injectable()
export class DeliveryDatesService {
  private readonly logger = new Logger(DeliveryDatesService.name);

  constructor(
    private readonly repo: DeliveryRepository,
    private readonly delivery: DeliveryService,
    private readonly settings: SettingsService,
  ) {}

  /** Cron `delivery-dates:generate` — F5 `DeliveryService.generateDates` ile aynı (idempotent). */
  generate(weeks?: number, now: Date = new Date()): Promise<DeliveryDatesGenerateResult> {
    return this.delivery.generateDates(weeks, now);
  }

  /** Atomik rezerv; dolu → 409 `DAY_FULL`, kapalı → 409 `DAY_CLOSED`, yok → 404. Döner: güncel satır (reserved artmış). */
  async reserve(deliveryDateId: string, tx?: DbClient): Promise<DateWithZoneRecord> {
    const affected = await this.repo.reserve(deliveryDateId, tx);
    const row = await this.repo.findDateByIdTx(deliveryDateId, tx);
    if (!row) {
      throw new NotFoundException({ message: `Teslimat tarihi bulunamadı: ${deliveryDateId}`, error: 'DELIVERY_DATE_NOT_FOUND' });
    }
    if (affected > 0) return row;
    if (row.status !== 'OPEN') {
      throw new ConflictException({ message: 'Bu teslimat günü kapalı; lütfen başka bir gün seç.', error: 'DAY_CLOSED' });
    }
    throw new ConflictException({ message: 'Bu teslimat günü dolu; lütfen başka bir gün seç.', error: 'DAY_FULL' });
  }

  /** Rezerv iadesi (iptal/atlama/tahsil edilemedi). Tarih yoksa sessizce geçer (log). */
  async release(deliveryDateId: string, tx?: DbClient): Promise<void> {
    const affected = await this.repo.release(deliveryDateId, tx);
    if (affected === 0) this.logger.warn(`release: teslimat tarihi bulunamadı (${deliveryDateId})`);
  }

  /**
   * (zone, date) satırını bulur; yoksa oluşturur. `date`: `YYYY-MM-DD` ya da UTC gece yarısı Date.
   * Kesim anı = Setting `commerce.cutoff` (varsayılan teslimattan 1 gün önce 12:00 Europe/Istanbul), capacity = bölge kapasitesi.
   */
  async findOrCreateFor(zoneId: string, date: IsoDate | Date, tx?: DbClient): Promise<DateWithZoneRecord> {
    const iso = typeof date === 'string' ? date : utcToIsoDate(date);
    let dateUtc: Date;
    try {
      dateUtc = isoDateToUtc(iso);
    } catch {
      throw new BadRequestException({ message: `Takvimde olmayan gün: ${iso}`, error: 'INVALID_DATE' });
    }
    const existing = await this.repo.findDateByZoneAndDate(zoneId, dateUtc, tx);
    if (existing) return existing;

    const commerce = await this.settings.getCommerce();
    const day = deliveryDayForWeekday(weekdayOf(iso));
    const allowed = new Set(
      commerce.deliveryDays.map((d) => deliveryDayFromSlug(d.id)).filter((d): d is DeliveryDay => d !== null),
    );
    if (!day || !allowed.has(day)) {
      throw new BadRequestException({ message: `${iso} bir teslimat günü değil`, error: 'NOT_DELIVERY_DAY' });
    }
    const zone = await this.repo.findZoneById(zoneId);
    if (!zone) throw new NotFoundException({ message: `Bölge bulunamadı: ${zoneId}`, error: 'ZONE_NOT_FOUND' });
    const cutoffAt = computeCutoffAt(iso, commerce.cutoff, DEFAULT_TZ);
    try {
      const created = await this.repo.createDate({ zoneId, day, date: dateUtc, cutoffAt, capacity: zone.capacityPerDay }, tx);
      this.logger.log(`DeliveryDate oluşturuldu: ${zone.slug} ${iso} (${day}, kesim ${cutoffAt.toISOString()})`);
      return created;
    } catch (err) {
      // Yarış: aynı (zone,date) eşzamanlı oluşturuldu → var olanı oku
      if (prismaCode(err) === 'P2002') {
        const row = await this.repo.findDateByZoneAndDate(zoneId, dateUtc, tx);
        if (row) return row;
      }
      throw err;
    }
  }

  /**
   * Bölge + gün için `after` anından sonra kesimi geçmemiş ilk tarih — cart.js `nextDeliveryDate(dayId)` kuralı
   * (haftanın bir sonraki o günü; kesimi geçtiyse bir hafta sonrası). DB'de yoksa üretilir (findOrCreateFor).
   * Not: kapalı (CLOSED) ya da dolu bir gün de dönebilir — çağıran `isLocked/isFull` ile karar verir.
   */
  async nextFor(zoneId: string, day: DeliveryDay, after: Date, tx?: DbClient): Promise<DateWithZoneRecord> {
    const commerce = await this.settings.getCommerce();
    const slot = nextDeliveryDateFor(day, after, { tz: DEFAULT_TZ, rule: commerce.cutoff });
    return this.findOrCreateFor(zoneId, slot.date, tx);
  }

  /** Kesim geçti (`cutoffAt <= now`) ya da gün OPEN değil → kilitli (bootstrap `deliveryDates[].locked` ile aynı kural). */
  isLocked(deliveryDate: DeliveryDateLike, now: Date): boolean {
    return deliveryDate.cutoffAt.getTime() <= now.getTime() || deliveryDate.status !== 'OPEN';
  }

  /** reserved >= capacity → dolu (checkout 409 `DAY_FULL`). */
  isFull(deliveryDate: DeliveryDateCapacityLike): boolean {
    return deliveryDate.reserved >= deliveryDate.capacity;
  }
}
