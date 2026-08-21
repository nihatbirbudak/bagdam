import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { utcToIsoDate, type SubscriptionNotification, type SubscriptionNotifierEvent } from '@bagdam/shared';
import { webUrl } from '../mail/mail.constants';
import { NOTIFIER, type Notifier, type NotifierCycle, type NotifierUser } from '../mail/notifier.interface';
import { buildPayLinkUrl } from '../payments/payments.constants';
import { NOTIFIER_BUFFER_SIZE, NOTIFIER_MAIL_DELAY_MS } from './subscriptions.constants';
import { SubscriptionsRepository, type CycleWithSubRecord } from './subscriptions.repository';

export interface SubscriptionNotifyInput {
  subscriptionId: string;
  userId: string;
  cycleId?: string | null;
  data?: Record<string, unknown>;
}

/** Anonimleştirilmiş hesaba (CustomersService.anonymize) e-posta gönderilmez. */
const ANONYMIZED_EMAIL_SUFFIX = '@anon.local';

/** Kutunun teslim edildiği/edileceği sayılan cycle durumları — iptal teyidindeki "son kutu" bunlardan seçilir. */
const LIVE_CYCLE_STATES: readonly string[] = ['LOCKED', 'AWAITING_PAYMENT', 'UNPAID', 'CHARGED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(typeof value === 'object' && value !== null ? value.toString() : value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * SubscriptionNotifier — motor olaylarının tek çıkış kapısı.
 *  - F7'de STUB'dı (yalnız Logger + bellek tamponu).
 *  - F10: aynı olaylar `NOTIFIER` (MailNotifier) şablonlarına BAĞLANDI (ADR-0014 listesi). `emit` hâlâ senkron ve
 *    asla fırlatmaz; e-posta gönderimi motor işleminin DIŞINDA, gecikmeli (NOTIFIER_MAIL_DELAY_MS) koşar —
 *    böylece bildirim yükü (cycle/abonelik kaydı) çevreleyen transaction COMMIT edildikten sonra okunur ve
 *    tahsilat/dunning yazımları e-posta hatasından etkilenmez. `whenIdle()` bekleyen gönderimleri bekler (testler/job'lar).
 *  - `recent()` testlerin ve admin teşhisinin okuduğu son N kayıt.
 * Olay → şablon: cycle.charged → mail.cycle-charged · cycle.payment-failed → mail.cycle-payment-failed ·
 * cycle.awaiting-payment → mail.cycle-awaiting-payment · subscription.cutoff-reminder → mail.cutoff-reminder (cycle
 * başına bir kez) · subscription.cancelled → mail.subscription-cancelled · subscription.past-due → mail.subscription-past-due.
 * `subscription.activated` için ayrı e-posta YOKTUR: aktivasyon `mail.order-paid` ile bildirilir (F8).
 */
@Injectable()
export class SubscriptionNotifier {
  private readonly logger = new Logger(SubscriptionNotifier.name);
  private readonly buffer: SubscriptionNotification[] = [];
  private readonly pending = new Set<Promise<void>>();

  // NOT: birleşim tipli parametrede (X | null) TypeScript design:paramtypes olarak `Object` yazar → Nest çözemez;
  // bu yüzden token AÇIKÇA verilir. @Optional: MailModule/repo bulunmayan birim testlerinde bildirim sessizce kapanır.
  constructor(
    @Optional() @Inject(SubscriptionsRepository) private readonly repo: SubscriptionsRepository | null = null,
    @Optional() @Inject(NOTIFIER) private readonly mail: Notifier | null = null,
  ) {}

  emit(event: SubscriptionNotifierEvent, input: SubscriptionNotifyInput, at: Date = new Date()): void {
    const record = this.record(event, input, at);
    if (!record) return;
    this.schedule(record, NOTIFIER_MAIL_DELAY_MS);
  }

  /**
   * `emit` + gönderimi BEKLER (gecikmesiz). Yalnız transaction DIŞINDAN çağrılmalıdır —
   * `reminders:cutoff` job'ı bunu kullanır ki CronLog gerçek gönderim sayısını görsün.
   */
  async emitAndDeliver(event: SubscriptionNotifierEvent, input: SubscriptionNotifyInput, at: Date = new Date()): Promise<void> {
    const record = this.record(event, input, at);
    if (!record) return;
    await this.deliver(record);
  }

  /** Bekleyen tüm e-posta gönderimleri bitene kadar bekler (testler; job kapanışı). */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /** Son olaylar (yeni → eski). Filtre isteğe bağlı. */
  recent(filter?: { event?: SubscriptionNotifierEvent; subscriptionId?: string }): SubscriptionNotification[] {
    return [...this.buffer]
      .reverse()
      .filter((n) => (!filter?.event || n.event === filter.event) && (!filter?.subscriptionId || n.subscriptionId === filter.subscriptionId));
  }

  clear(): void {
    this.buffer.length = 0;
  }

  // ── İç işleyiş ──────────────────────────────────────────────────────────────

  private record(event: SubscriptionNotifierEvent, input: SubscriptionNotifyInput, at: Date): SubscriptionNotification | null {
    try {
      const record: SubscriptionNotification = {
        event,
        subscriptionId: input.subscriptionId,
        userId: input.userId,
        cycleId: input.cycleId ?? null,
        data: input.data ?? {},
        at: at.toISOString(),
      };
      this.buffer.push(record);
      if (this.buffer.length > NOTIFIER_BUFFER_SIZE) this.buffer.splice(0, this.buffer.length - NOTIFIER_BUFFER_SIZE);
      this.logger.log(`${event} sub=${input.subscriptionId}${input.cycleId ? ` cycle=${input.cycleId}` : ''}`);
      return record;
    } catch (err) {
      this.logger.error(`Bildirim kaydedilemedi (${event}): ${(err as Error).message}`);
      return null;
    }
  }

  /** Gecikmeli gönderim (transaction commit'ini beklemek için); hata asla dışarı sızmaz. */
  private schedule(record: SubscriptionNotification, delayMs: number): void {
    if (!this.mail || !this.repo) return;
    const task = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        void this.deliver(record).finally(resolve);
      }, delayMs);
      if (typeof timer.unref === 'function') timer.unref();
    }).finally(() => {
      this.pending.delete(task);
    });
    this.pending.add(task);
  }

  private async deliver(record: SubscriptionNotification): Promise<void> {
    if (!this.mail || !this.repo) return;
    try {
      await this.dispatch(record);
    } catch (err) {
      this.logger.error(`Bildirim e-postası gönderilemedi (${record.event}): ${(err as Error).message}`);
    }
  }

  private async dispatch(record: SubscriptionNotification): Promise<void> {
    const mail = this.mail;
    const repo = this.repo;
    if (!mail || !repo) return;
    const data = record.data;

    switch (record.event) {
      case 'subscription.activated':
        return; // sipariş onayı e-postası (mail.order-paid) yeterli — ayrı şablon yok
      case 'cycle.charged': {
        const cycle = await this.loadCycle(record.cycleId);
        if (!cycle) return;
        const isDelta = data.delta === true;
        await mail.notify('cycle.charged', {
          cycle: cycle.vars,
          amount: num(data.amount),
          orderNo: (isDelta ? cycle.row.deltaOrder?.orderNo : cycle.row.order?.orderNo) ?? null,
          isDelta,
        });
        return;
      }
      case 'cycle.payment-failed': {
        const cycle = await this.loadCycle(record.cycleId);
        if (!cycle) return;
        const isDelta = data.delta === true;
        const amount = isDelta ? num(cycle.row.deltaOrder?.grandTotal) : num(cycle.row.total ?? cycle.row.order?.grandTotal);
        await mail.notify('cycle.payment-failed', {
          cycle: cycle.vars,
          amount,
          failure: typeof data.failure === 'string' ? data.failure : null,
          nextRetryAt: cycle.row.nextRetryAt ?? null,
          attemptNo: cycle.row.retryCount + 1,
          isDelta,
        });
        return;
      }
      case 'cycle.awaiting-payment': {
        const cycle = await this.loadCycle(record.cycleId);
        if (!cycle) return;
        const linkToken = typeof data.linkToken === 'string' ? data.linkToken : '';
        if (!linkToken) {
          this.logger.warn(`cycle.awaiting-payment: linkToken yok (cycle ${record.cycleId}) — e-posta atlandı`);
          return;
        }
        const expiresAt = typeof data.linkExpiresAt === 'string' ? new Date(data.linkExpiresAt) : (cycle.row.paymentDueAt ?? new Date());
        await mail.notify('cycle.awaiting-payment', {
          cycle: cycle.vars,
          amount: num(data.amount),
          payUrl: buildPayLinkUrl(linkToken),
          expiresAt,
          attemptNo: cycle.row.retryCount + 1,
        });
        return;
      }
      case 'subscription.cutoff-reminder': {
        const cycle = await this.loadCycle(record.cycleId);
        if (!cycle) return;
        const cutoffAt = typeof data.cutoffAt === 'string' ? new Date(data.cutoffAt) : cycle.row.deliveryDate.cutoffAt;
        await mail.notify('subscription.cutoff-reminder', { cycle: cycle.vars, cutoffAt });
        return;
      }
      case 'subscription.cancelled': {
        const sub = await repo.findSubscriptionById(record.subscriptionId);
        if (!sub || !this.mailable(sub.user.email)) return;
        const cycles = await repo.findCyclesOfSubscription(sub.id);
        const lastBox = cycles
          .filter((c) => LIVE_CYCLE_STATES.includes(c.status))
          .map((c) => c.deliveryDate.date)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        const refundDueAt = typeof data.refundDueAt === 'string' ? new Date(data.refundDueAt) : null;
        await mail.notify('subscription.cancelled', {
          user: toNotifierUser(sub.user),
          subscriptionId: sub.id,
          tierName: sub.tier.label,
          effectiveAt: typeof data.effectiveAt === 'string' ? new Date(data.effectiveAt) : new Date(record.at),
          lastBoxOn: lastBox ? utcToIsoDate(lastBox) : null,
          refundAmount: num(data.refundAmount),
          refundDueAt,
        });
        return;
      }
      case 'subscription.past-due': {
        const sub = await repo.findSubscriptionById(record.subscriptionId);
        if (!sub || !this.mailable(sub.user.email)) return;
        await mail.notify('subscription.past-due', {
          user: toNotifierUser(sub.user),
          subscriptionId: sub.id,
          tierName: sub.tier.label,
          failedCycles: typeof data.failedCycles === 'number' ? data.failedCycles : sub.failedCycles,
        });
        return;
      }
      default:
        this.logger.warn(`Şablonu olmayan motor olayı: ${String(record.event)}`);
    }
  }

  /** Cycle + abonelik kaydı → MailNotifier'ın beklediği `NotifierCycle` bağlamı (yoksa/alıcısı yoksa null). */
  private async loadCycle(cycleId: string | null): Promise<{ row: CycleWithSubRecord; vars: NotifierCycle } | null> {
    if (!cycleId || !this.repo) return null;
    const row = await this.repo.findCycleById(cycleId);
    if (!row) {
      this.logger.warn(`Bildirim için cycle bulunamadı: ${cycleId}`);
      return null;
    }
    const sub = row.subscription;
    if (!this.mailable(sub.user.email)) return null;
    const base = webUrl();
    const vars: NotifierCycle = {
      cycleId: row.id,
      cycleNo: row.cycleNo,
      subscriptionId: sub.id,
      user: toNotifierUser(sub.user),
      tierName: sub.tier.label,
      deliveryOn: utcToIsoDate(row.deliveryDate.date),
      deliveryDay: sub.deliveryDay,
      addressLine: sub.address?.line ?? '',
      zoneName: sub.address?.zone.name ?? sub.zone.name,
      items: row.items.map((i) => ({
        name: i.label ?? i.product.name,
        qty: num(i.qty),
        unit: i.unit ?? i.product.unit,
        pref: i.pref,
        source: i.source,
      })),
      accountUrl: `${base}/uyelik.html`,
      boxUrl: `${base}/kutu.html?tier=${sub.tier.slug}`,
    };
    return { row, vars };
  }

  /** Anonimleştirilmiş / boş e-postaya gönderim yok. */
  private mailable(email: string | null | undefined): boolean {
    const value = (email ?? '').trim().toLowerCase();
    if (!value || value.endsWith(ANONYMIZED_EMAIL_SUFFIX)) {
      return false;
    }
    return true;
  }
}

function toNotifierUser(user: { id: string; email: string; name: string | null }): NotifierUser {
  return { id: user.id, email: user.email, name: user.name };
}
