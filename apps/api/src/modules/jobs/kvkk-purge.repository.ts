import { Injectable } from '@nestjs/common';
import { Prisma, type AuditLog, type OrderStatus, type SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type AuditLogRecord = AuditLog;

/** Anonimleştirme adayı — yalnız kimlik (PII taşımaz; anonimleştirme CustomersService'te). */
export interface InactiveCustomerRow {
  id: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** Aboneliği "canlı" sayan durumlar — bu hesap anonimleştirilmez. */
const LIVE_SUBSCRIPTION_STATES: SubscriptionStatus[] = ['PENDING', 'ACTIVE', 'PAST_DUE', 'CANCEL_REQUESTED', 'PAUSED'];
/** Açık sipariş durumları — bu hesap anonimleştirilmez. */
const OPEN_ORDER_STATES: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'];

/**
 * KvkkPurgeRepository — `kvkk:purge` job'ının veri erişimi (SystemLog / CronLog / AuditLog / pasif müşteri adayları).
 * Prisma YALNIZ burada (ADR-0002); tüm zaman sınırları parametreyle gelir (ADR-0004: ham SQL'de `now()` yok).
 * MailLog temizliği MailService.purgeLogsOlderThan'da (önizleme dosyaları da orada silinir).
 */
@Injectable()
export class KvkkPurgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `before` anından eski SystemLog satırları silinir → silinen sayı. */
  async deleteSystemLogsBefore(before: Date): Promise<number> {
    const r = await this.prisma.systemLog.deleteMany({ where: { createdAt: { lt: before } } });
    return r.count;
  }

  /** `before` anından eski CronLog satırları silinir (koşan job'ın kendi satırı `startedAt = now` olduğu için kalır). */
  async deleteCronLogsBefore(before: Date): Promise<number> {
    const r = await this.prisma.cronLog.deleteMany({ where: { startedAt: { lt: before } } });
    return r.count;
  }

  /**
   * PII maskelemesi için AuditLog penceresi: `[from, before)` (from yoksa baştan), createdAt artan, imleçli.
   * Satır SİLİNMEZ — yalnız PII alanları `[silindi]` yapılır (denetim izi korunur).
   */
  findAuditLogsForMasking(before: Date, from: Date | null, take: number, cursorId: string | null): Promise<AuditLogRecord[]> {
    return this.prisma.auditLog.findMany({
      where: { createdAt: { lt: before, ...(from ? { gte: from } : {}) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
  }

  updateAuditLogPii(
    id: string,
    data: { actorEmail: string | null; ipAddress: string | null; summary: string | null; oldValues: Prisma.InputJsonValue | null; newValues: Prisma.InputJsonValue | null },
  ): Promise<AuditLogRecord> {
    return this.prisma.auditLog.update({
      where: { id },
      data: {
        actorEmail: data.actorEmail,
        ipAddress: data.ipAddress,
        summary: data.summary,
        oldValues: data.oldValues === null ? Prisma.DbNull : data.oldValues,
        newValues: data.newValues === null ? Prisma.DbNull : data.newValues,
      },
    });
  }

  /**
   * Anonimleştirme adayları: CUSTOMER, silinmemiş, henüz anonimleştirilmemiş, `before` anından beri giriş yapmamış
   * (girişi hiç yoksa kaydı da eski), canlı aboneliği ve açık siparişi olmayan, `before`'dan sonra siparişi bulunmayan.
   */
  findInactiveCustomers(before: Date, take: number): Promise<InactiveCustomerRow[]> {
    return this.prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        deletedAt: null,
        anonymizedAt: null,
        OR: [{ lastLoginAt: { lt: before } }, { AND: [{ lastLoginAt: null }, { createdAt: { lt: before } }] }],
        subscriptions: { none: { status: { in: LIVE_SUBSCRIPTION_STATES } } },
        orders: { none: { OR: [{ status: { in: OPEN_ORDER_STATES } }, { createdAt: { gte: before } }] } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: { id: true, lastLoginAt: true, createdAt: true },
    });
  }
}
