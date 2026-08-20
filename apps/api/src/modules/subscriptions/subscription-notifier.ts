import { Injectable, Logger } from '@nestjs/common';
import type { SubscriptionNotification, SubscriptionNotifierEvent } from '@bagdam/shared';
import { NOTIFIER_BUFFER_SIZE } from './subscriptions.constants';

export interface SubscriptionNotifyInput {
  subscriptionId: string;
  userId: string;
  cycleId?: string | null;
  data?: Record<string, unknown>;
}

/**
 * SubscriptionNotifier — F7 STUB (BACKEND-PLANI F7 "Notifier stub"): motor olayları burada toplanır
 * (Logger + bellek tamponu). F10'da her olay `NOTIFIER` (MailNotifier) şablonuna bağlanır (ADR-0014 listesi);
 * o güne kadar e-posta gitmez, MailNotifier'ın "bilinmeyen olay" uyarısı da üretilmez.
 * `recent()` testlerin ve admin teşhisinin okuduğu son N kayıt; `emit` asla fırlatmaz.
 */
@Injectable()
export class SubscriptionNotifier {
  private readonly logger = new Logger(SubscriptionNotifier.name);
  private readonly buffer: SubscriptionNotification[] = [];

  emit(event: SubscriptionNotifierEvent, input: SubscriptionNotifyInput, at: Date = new Date()): void {
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
      this.logger.log(`[stub] ${event} sub=${input.subscriptionId}${input.cycleId ? ` cycle=${input.cycleId}` : ''}`);
    } catch (err) {
      this.logger.error(`Bildirim kaydedilemedi (${event}): ${(err as Error).message}`);
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
}
