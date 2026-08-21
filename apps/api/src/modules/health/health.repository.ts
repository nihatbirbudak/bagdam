import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/** HealthRepository — sağlık kartının okuduğu sayımlar (Prisma yalnız repository'de, ADR-0002). */
@Injectable()
export class HealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `SELECT 1` gidiş-dönüş süresi (ms). Hata fırlatırsa çağıran `down` sayar. */
  async pingMs(): Promise<number> {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return Date.now() - started;
  }

  /** MailLog: `since`'dan beri durum başına sayım. */
  async mailCountsSince(since: Date): Promise<Record<string, number>> {
    const rows = await this.prisma.mailLog.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const row of rows) out[row.status] = row._count._all;
    return out;
  }

  /** Ödeme problemleri özeti (sağlık kartı uyarısı): açık başarısız tahsilat sayısı. */
  async openPaymentIssues(): Promise<{ unpaidCycles: number; failedOrders: number }> {
    const [unpaidCycles, failedOrders] = await Promise.all([
      this.prisma.subscriptionCycle.count({ where: { status: { in: ['UNPAID', 'AWAITING_PAYMENT'] } } }),
      this.prisma.order.count({ where: { status: 'PAYMENT_FAILED' } }),
    ]);
    return { unpaidCycles, failedOrders };
  }
}
