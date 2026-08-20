import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  addCalendarDays,
  calendarDateIn,
  DEFAULT_TZ,
  deliveryDayFromSlug,
  isoDateToUtc,
  nextDeliveryDates,
  type DeliveryDate,
  type DeliveryDateAdmin,
  type DeliveryDatesGenerateResult,
  type DeliveryDay,
  type DeliveryZone,
  type DeliveryZonePublic,
  type IsoDate,
} from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import type { Cache } from 'cache-manager';
import { BOOTSTRAP_DELIVERY_WEEKS, DEFAULT_ZONE_SLUG } from '../catalog/catalog.constants';
import { invalidateBootstrapCache } from '../settings/bootstrap-cache.util';
import { SettingsService } from '../settings/settings.service';
import { toDeliveryDateAdmin, toDeliveryDateDto, toZoneAdmin, toZonePublic } from './delivery.mapper';
import { DeliveryRepository, type ZoneCreateInput, type ZoneUpdateInput } from './delivery.repository';
import type { DeliveryDatePatchDto } from './dto/date-patch.dto';
import type { AdminDeliveryDatesQueryDto } from './dto/dates-query.dto';
import type { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from './dto/zone.dto';

/** Admin tarih listesi varsayılan ufku (hafta) — Setting ufku yoksa. */
const ADMIN_DATES_DEFAULT_WEEKS = 8;
/** Admin tarih listesi en geniş aralık (gün) — yanlışlıkla tüm tabloyu çekmesin. */
const ADMIN_DATES_MAX_RANGE_DAYS = 400;

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function prismaCode(err: unknown): string | null {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
}

/** `YYYY-MM-DD` → UTC gece yarısı; takvimde yoksa 400. */
function toDateOrThrow(field: string, value: string): Date {
  try {
    return isoDateToUtc(value);
  } catch {
    throw new BadRequestException(`${field} takvimde olmayan bir gün: ${value}`);
  }
}

/**
 * DeliveryService — bölge + teslimat tarihi iş kuralları (ADR-0005, BACKEND-PLANI §3 delivery satırı, §4 ekran 14a/14b).
 *  - Public: aktif bölgeler; `getDates(zone, weeks)` bootstrap `deliveryDates` ile AYNI kaynak/kural (DB DeliveryDate;
 *    locked = kesim geçti ya da OPEN değil; full = reserved ≥ capacity). Catalog mapper'a dokunulmadı; E catalog'u buna bağlar.
 *  - Admin: bölge CRUD (slug 409; silme yok — adres/tarih FK'leri; isActive ile kapatılır), tarih listesi/kapasite/durum,
 *    `generateDates(weeks)`: aktif bölge × Setting deliveryDays (cutoff kuralı, TZ Europe/Istanbul) → idempotent eşitleme;
 *    cron `delivery-dates:generate` F7'de aynı yöntemi çağırır.
 *  - Bölge/tarih değişince anonim bootstrap cache'i düşer (deliveryFee/deliveryDates/commerce.freeThreshold oradan okunur).
 *  - Zaman: `now` tek noktadan alınır ve aşağı geçirilir (ADR-0004; ham SQL yok).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly repo: DeliveryRepository,
    private readonly settings: SettingsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ── Public ───────────────────────────────────────────────────────────────────

  async listPublicZones(): Promise<DeliveryZonePublic[]> {
    const rows = await this.repo.findActiveZones();
    return rows.map(toZonePublic);
  }

  /**
   * Bölgenin bugünden itibaren `weeks` haftalık teslimat tarihleri (DB'deki DeliveryDate satırları; üretilmemiş günler listede yok).
   * Bölge yok/pasif → 404.
   */
  async getDates(zoneSlug: string = DEFAULT_ZONE_SLUG, weeks: number = BOOTSTRAP_DELIVERY_WEEKS, now: Date = new Date()): Promise<DeliveryDate[]> {
    const zone = await this.repo.findZoneBySlug(zoneSlug);
    if (!zone || !zone.isActive) throw new NotFoundException(`Teslimat bölgesi bulunamadı: ${zoneSlug}`);
    const today = calendarDateIn(now, DEFAULT_TZ);
    const rows = await this.repo.findDates(zone.id, isoDateToUtc(today), isoDateToUtc(addCalendarDays(today, weeks * 7)));
    return rows.map((row) => toDeliveryDateDto(row, now));
  }

  // ── Admin: bölgeler ──────────────────────────────────────────────────────────

  async listZones(): Promise<DeliveryZone[]> {
    const rows = await this.repo.findAllZones();
    return rows.map(toZoneAdmin);
  }

  async getZone(id: string): Promise<DeliveryZone> {
    const row = await this.repo.findZoneById(id);
    if (!row) throw new NotFoundException(`Bölge bulunamadı: ${id}`);
    return toZoneAdmin(row);
  }

  async createZone(dto: CreateDeliveryZoneDto): Promise<DeliveryZone> {
    const data: ZoneCreateInput = {
      name: dto.name,
      slug: dto.slug,
      fee: toDecimal(dto.fee),
      freeThreshold: dto.freeThreshold === undefined || dto.freeThreshold === null ? null : toDecimal(dto.freeThreshold),
      capacityPerDay: dto.capacityPerDay ?? 999,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };
    try {
      const row = await this.repo.createZone(data);
      await invalidateBootstrapCache(this.cache);
      this.logger.log(`Bölge oluşturuldu: ${row.slug}`);
      return toZoneAdmin(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu slug zaten kullanılıyor: ${dto.slug}`);
      throw err;
    }
  }

  async updateZone(id: string, dto: UpdateDeliveryZoneDto): Promise<DeliveryZone> {
    await this.getZone(id);
    const data: ZoneUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.fee !== undefined) data.fee = toDecimal(dto.fee);
    if (dto.freeThreshold !== undefined) data.freeThreshold = dto.freeThreshold === null ? null : toDecimal(dto.freeThreshold);
    if (dto.capacityPerDay !== undefined) data.capacityPerDay = dto.capacityPerDay;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (Object.keys(data).length === 0) throw new BadRequestException('Güncellenecek alan yok');
    try {
      const row = await this.repo.updateZone(id, data);
      await invalidateBootstrapCache(this.cache);
      return toZoneAdmin(row);
    } catch (err) {
      if (prismaCode(err) === 'P2002') throw new ConflictException(`Bu slug zaten kullanılıyor: ${dto.slug ?? ''}`);
      throw err;
    }
  }

  async setZoneActive(id: string, isActive: boolean): Promise<DeliveryZone> {
    await this.getZone(id);
    const row = await this.repo.updateZone(id, { isActive });
    await invalidateBootstrapCache(this.cache);
    return toZoneAdmin(row);
  }

  // ── Admin: tarihler ──────────────────────────────────────────────────────────

  /** Tarih listesi: zone (slug) isteğe bağlı; from/to yoksa bugün → +ufuk hafta. */
  async listDates(query: AdminDeliveryDatesQueryDto, now: Date = new Date()): Promise<DeliveryDateAdmin[]> {
    let zoneId: string | undefined;
    if (query.zone) {
      const zone = await this.repo.findZoneBySlug(query.zone);
      if (!zone) throw new NotFoundException(`Bölge bulunamadı: ${query.zone}`);
      zoneId = zone.id;
    }
    const today = calendarDateIn(now, DEFAULT_TZ);
    const from: IsoDate = query.from ?? today;
    const fromUtc = toDateOrThrow('from', from);
    const to: IsoDate = query.to ?? addCalendarDays(from, (await this.horizonWeeks()) * 7);
    const toUtc = toDateOrThrow('to', to);
    if (toUtc.getTime() < fromUtc.getTime()) throw new BadRequestException('to, from tarihinden önce olamaz');
    if ((toUtc.getTime() - fromUtc.getTime()) / 86_400_000 > ADMIN_DATES_MAX_RANGE_DAYS) {
      throw new BadRequestException(`Aralık en çok ${ADMIN_DATES_MAX_RANGE_DAYS} gün olabilir`);
    }
    // to dahil olsun: [from, to+1)
    const rows = await this.repo.findDates(zoneId, fromUtc, isoDateToUtc(addCalendarDays(to, 1)));
    return rows.map(toDeliveryDateAdmin);
  }

  async patchDate(id: string, dto: DeliveryDatePatchDto): Promise<DeliveryDateAdmin> {
    if (dto.capacity === undefined && dto.status === undefined) throw new BadRequestException('capacity ya da status verilmeli');
    const existing = await this.repo.findDateById(id);
    if (!existing) throw new NotFoundException(`Teslimat tarihi bulunamadı: ${id}`);
    const row = await this.repo.updateDate(id, {
      ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    });
    await invalidateBootstrapCache(this.cache);
    return toDeliveryDateAdmin(row);
  }

  /**
   * Aktif bölgeler × Setting `commerce.deliveryDays` → `weeks` hafta ileri (bugün dahil, kilitliler dahil) teslimat tarihleri;
   * (zone,date) yoksa oluşturulur (capacity = bölge kapasitesi), varsa yalnız day/cutoffAt tazelenir. İdempotent.
   * `weeks` yoksa Setting `deliveryDatesHorizonWeeks`. Cron F7 bu yöntemi çağırır.
   */
  async generateDates(weeks?: number, now: Date = new Date()): Promise<DeliveryDatesGenerateResult> {
    const commerce = await this.settings.getCommerce();
    const horizon = weeks ?? commerce.deliveryDatesHorizonWeeks;
    const days = commerce.deliveryDays
      .map((d) => deliveryDayFromSlug(d.id))
      .filter((d): d is DeliveryDay => d !== null);
    if (days.length === 0) throw new BadRequestException('Setting commerce.deliveryDays geçerli teslimat günü içermiyor');

    const slots = nextDeliveryDates(now, days, horizon, { tz: DEFAULT_TZ, rule: commerce.cutoff, includeLocked: true });
    const zones = await this.repo.findActiveZones();
    let created = 0;
    let updated = 0;
    for (const zone of zones) {
      const result = await this.repo.syncZoneDates(
        zone.id,
        zone.capacityPerDay,
        slots.map((s) => ({ day: s.day, date: isoDateToUtc(s.date), cutoffAt: s.cutoffAt })),
      );
      created += result.created;
      updated += result.updated;
    }
    if (created > 0 || updated > 0) await invalidateBootstrapCache(this.cache);
    const from = slots[0]?.date ?? null;
    const to = slots[slots.length - 1]?.date ?? null;
    this.logger.log(`delivery-dates:generate — ${zones.length} bölge × ${slots.length} tarih (${from ?? '-'} → ${to ?? '-'}): ${created} yeni, ${updated} güncellendi`);
    return { weeks: horizon, from, to, zones: zones.length, created, updated };
  }

  // ── Yardımcılar ─────────────────────────────────────────────────────────────

  private async horizonWeeks(): Promise<number> {
    try {
      return (await this.settings.getCommerce()).deliveryDatesHorizonWeeks || ADMIN_DATES_DEFAULT_WEEKS;
    } catch {
      return ADMIN_DATES_DEFAULT_WEEKS;
    }
  }
}
