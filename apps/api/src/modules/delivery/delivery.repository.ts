import { Injectable } from '@nestjs/common';
import { Prisma, type DeliveryDate, type DeliveryDay, type DeliveryZone } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type ZoneRecord = DeliveryZone;

export const DATE_WITH_ZONE_INCLUDE = { zone: { select: { slug: true, name: true } } } satisfies Prisma.DeliveryDateInclude;
export type DateWithZoneRecord = Prisma.DeliveryDateGetPayload<{ include: typeof DATE_WITH_ZONE_INCLUDE }>;
export type DateRecord = DeliveryDate;

export interface ZoneCreateInput {
  name: string;
  slug: string;
  fee: Prisma.Decimal;
  freeThreshold: Prisma.Decimal | null;
  capacityPerDay: number;
  isActive: boolean;
  sortOrder: number;
}
export type ZoneUpdateInput = Partial<ZoneCreateInput>;

/** `generate` için tek tarih adayı (takvim günü UTC gece yarısı Date; cutoffAt UTC instant). */
export interface DateSlotInput {
  day: DeliveryDay;
  date: Date;
  cutoffAt: Date;
}

export interface SyncDatesResult {
  created: number;
  updated: number;
}

/**
 * DeliveryRepository — DeliveryZone + DeliveryDate; Prisma YALNIZ burada (ADR-0002).
 * Zaman: ham SQL yok; takvim günleri UTC gece yarısı Date, kesim anları UTC instant (ADR-0004).
 */
@Injectable()
export class DeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Bölgeler ────────────────────────────────────────────────────────────────

  findActiveZones(): Promise<ZoneRecord[]> {
    return this.prisma.deliveryZone.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] });
  }

  findAllZones(): Promise<ZoneRecord[]> {
    return this.prisma.deliveryZone.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] });
  }

  findZoneById(id: string): Promise<ZoneRecord | null> {
    return this.prisma.deliveryZone.findUnique({ where: { id } });
  }

  findZoneBySlug(slug: string): Promise<ZoneRecord | null> {
    return this.prisma.deliveryZone.findUnique({ where: { slug } });
  }

  createZone(data: ZoneCreateInput): Promise<ZoneRecord> {
    return this.prisma.deliveryZone.create({ data });
  }

  updateZone(id: string, data: ZoneUpdateInput): Promise<ZoneRecord> {
    return this.prisma.deliveryZone.update({ where: { id }, data });
  }

  // ── Tarihler ────────────────────────────────────────────────────────────────

  /** [fromInclusive, toExclusive) aralığı; zoneId verilmezse tüm bölgeler. Sıra: tarih → bölge. */
  findDates(zoneId: string | undefined, fromInclusive: Date, toExclusive: Date): Promise<DateWithZoneRecord[]> {
    return this.prisma.deliveryDate.findMany({
      where: { ...(zoneId ? { zoneId } : {}), date: { gte: fromInclusive, lt: toExclusive } },
      orderBy: [{ date: 'asc' }, { zone: { sortOrder: 'asc' } }],
      include: DATE_WITH_ZONE_INCLUDE,
    });
  }

  findDateById(id: string): Promise<DateWithZoneRecord | null> {
    return this.prisma.deliveryDate.findUnique({ where: { id }, include: DATE_WITH_ZONE_INCLUDE });
  }

  updateDate(id: string, data: { capacity?: number; status?: DeliveryDate['status'] }): Promise<DateWithZoneRecord> {
    return this.prisma.deliveryDate.update({ where: { id }, data, include: DATE_WITH_ZONE_INCLUDE });
  }

  /**
   * Bölge için tarih adaylarını eşitler (idempotent): (zone,date) yoksa oluşturulur (capacity = bölge kapasitesi,
   * status OPEN, reserved 0); varsa yalnız day/cutoffAt farklıysa tazelenir — reserved/capacity/status KORUNUR.
   * İkinci koşuda created=0, updated=0.
   */
  async syncZoneDates(zoneId: string, capacity: number, slots: readonly DateSlotInput[]): Promise<SyncDatesResult> {
    if (slots.length === 0) return { created: 0, updated: 0 };
    const existing = await this.prisma.deliveryDate.findMany({
      where: { zoneId, date: { in: slots.map((s) => s.date) } },
      select: { id: true, date: true, day: true, cutoffAt: true },
    });
    const byDate = new Map(existing.map((row) => [row.date.getTime(), row]));

    const toCreate: Prisma.DeliveryDateCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; day: DeliveryDay; cutoffAt: Date }> = [];
    for (const slot of slots) {
      const row = byDate.get(slot.date.getTime());
      if (!row) {
        toCreate.push({ zoneId, day: slot.day, date: slot.date, cutoffAt: slot.cutoffAt, capacity, reserved: 0, status: 'OPEN' });
      } else if (row.day !== slot.day || row.cutoffAt.getTime() !== slot.cutoffAt.getTime()) {
        toUpdate.push({ id: row.id, day: slot.day, cutoffAt: slot.cutoffAt });
      }
    }

    await this.prisma.$transaction([
      ...(toCreate.length > 0 ? [this.prisma.deliveryDate.createMany({ data: toCreate, skipDuplicates: true })] : []),
      ...toUpdate.map((u) => this.prisma.deliveryDate.update({ where: { id: u.id }, data: { day: u.day, cutoffAt: u.cutoffAt } })),
    ]);
    return { created: toCreate.length, updated: toUpdate.length };
  }
}
