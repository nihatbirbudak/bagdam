import { Injectable, Logger } from '@nestjs/common';
import {
  cancellationMachine,
  subscriptionMachine,
  type BootstrapSub,
  type CancelOutcome,
  type CancelResponse,
  type SubscriptionCancellation,
  type SubscriptionStatus,
} from '@bagdam/shared';
import { SettingsService } from '../../settings/settings.service';
import type { CancelRequestDto } from '../dto/me-subscription.dto';
import { ACTOR } from '../subscriptions.constants';
import { assertOr409, conflict, SUB_ERRORS } from '../subscriptions.errors';
import { toCancellationDto, toDecimal } from '../subscriptions.mapper';
import { SubscriptionsRepository, type CancellationRecord, type SubscriptionRecord } from '../subscriptions.repository';
import { CyclesService } from './cycles.service';
import { SubscriptionsService } from './subscriptions.service';

/** `POST …/cancel/confirm` yanıtı — abonelik artık müşteriye görünmez; iptal kaydı + son durum döner. */
export interface CancelConfirmResponse {
  cancellation: SubscriptionCancellation;
  status: SubscriptionStatus;
}

/**
 * CancellationService — iptal akışı (docs/state-machines.md §5, §11; ADR-0007): her akış bir SubscriptionCancellation satırı.
 *  request  → ACTIVE: CANCEL_REQUESTED + teklif (üye başına 1; `User.retentionOfferUsedAt` sunulduğunda yazılır — §14 #4);
 *             PAST_DUE: durum değişmez, teklif yok (doğrudan confirm); tek seferlik: teklif yok.
 *  accept   → RETENTION_ACCEPTED, sub ACTIVE, nextBoxDiscountPct
 *  confirm  → CANCELLED: kilitli cycle teslim edilir, SCHEDULED'lar iptal (DD iade), cycle#1 peşin iade; effectiveAt ≤ +7 g, refundDueAt ≤ +15 g
 *  abandon  → ABANDONED, sub ACTIVE (RESUMED)
 */
@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly settings: SettingsService,
    private readonly cycles: CyclesService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async request(userId: string, dto: CancelRequestDto, now: Date = new Date()): Promise<CancelResponse> {
    const sub = await this.subscriptions.requireForUser(userId);
    if (sub.status === 'CANCEL_REQUESTED') throw conflict(SUB_ERRORS.CANCEL_ALREADY_REQUESTED, 'İptal talebi zaten açık');
    if (sub.status !== 'ACTIVE' && sub.status !== 'PAST_DUE') {
      throw conflict(SUB_ERRORS.SUBSCRIPTION_TRANSITION_INVALID, `Bu durumda iptal talebi açılamaz: ${sub.status}`);
    }
    const commerce = await this.settings.getCommerce();
    const result = await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(sub.id, tx);
      const fresh = (await this.repo.findSubscriptionById(sub.id, tx))!;
      const open = await this.repo.findOpenCancellation(fresh.id, tx);
      if (open) throw conflict(SUB_ERRORS.CANCEL_ALREADY_REQUESTED, 'İptal talebi zaten açık');
      const offerAllowed = fresh.status === 'ACTIVE' && !fresh.isOneTime && commerce.retentionOffer.pct > 0;
      const offered = offerAllowed && (!commerce.retentionOffer.perUserOnce || fresh.user.retentionOfferUsedAt === null);
      const cancellation = await this.repo.createCancellation(
        { subscriptionId: fresh.id, reason: dto.reason, reasonText: dto.note ?? null, retentionOffered: offered, outcome: 'PENDING', requestedAt: now },
        tx,
      );
      if (fresh.status === 'ACTIVE') {
        assertOr409(subscriptionMachine, 'ACTIVE', 'CANCEL_REQUESTED');
        await this.repo.updateSubscription(fresh.id, { status: 'CANCEL_REQUESTED', cancelRequestedAt: now }, tx);
      }
      await this.repo.addEvent({ subscriptionId: fresh.id, cycleId: null, type: 'CANCEL_REQUESTED', actor: ACTOR.USER, data: { cancellationId: cancellation.id, reason: dto.reason, note: dto.note ?? null, fromStatus: fresh.status }, at: now }, tx);
      if (offered) {
        await this.repo.updateUser(fresh.userId, { retentionOfferUsedAt: now }, tx);
        await this.repo.addEvent({ subscriptionId: fresh.id, cycleId: null, type: 'RETENTION_OFFERED', actor: ACTOR.SYSTEM, data: { cancellationId: cancellation.id, pct: commerce.retentionOffer.pct, boxes: commerce.retentionOffer.boxes }, at: now }, tx);
      }
      return { cancellation, offered };
    });
    return {
      cancellationId: result.cancellation.id,
      offer: result.offered ? { pct: commerce.retentionOffer.pct, boxes: commerce.retentionOffer.boxes } : null,
    };
  }

  async accept(userId: string, now: Date = new Date()): Promise<BootstrapSub> {
    const sub = await this.subscriptions.requireForUser(userId);
    const commerce = await this.settings.getCommerce();
    await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(sub.id, tx);
      const open = await this.requireOpen(sub, tx);
      if (!open.retentionOffered) throw conflict(SUB_ERRORS.RETENTION_NOT_OFFERED, 'Bu akışta kalma teklifi sunulmadı');
      assertOr409(cancellationMachine, open.outcome as CancelOutcome, 'RETENTION_ACCEPTED');
      assertOr409(subscriptionMachine, sub.status as SubscriptionStatus, 'ACTIVE');
      await this.repo.updateCancellation(open.id, { outcome: 'RETENTION_ACCEPTED', confirmedAt: now }, tx);
      await this.repo.updateSubscription(sub.id, { status: 'ACTIVE', cancelRequestedAt: null, nextBoxDiscountPct: commerce.retentionOffer.pct }, tx);
      await this.repo.addEvent({ subscriptionId: sub.id, cycleId: null, type: 'RETENTION_USED', actor: ACTOR.USER, data: { cancellationId: open.id, pct: commerce.retentionOffer.pct, boxes: commerce.retentionOffer.boxes }, at: now }, tx);
    });
    return this.subscriptions.buildBootstrapSub((await this.repo.findSubscriptionById(sub.id))!, now);
  }

  async confirm(userId: string, now: Date = new Date()): Promise<CancelConfirmResponse> {
    const sub = await this.subscriptions.requireForUser(userId);
    const cancellation = await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(sub.id, tx);
      const open = await this.requireOpen(sub, tx);
      assertOr409(cancellationMachine, open.outcome as CancelOutcome, 'CANCELLED');
      const r = await this.cycles.cancelSubscription(sub.id, { actor: ACTOR.USER, reason: open.reason ?? undefined, requestedAt: open.requestedAt }, now, tx);
      return this.repo.updateCancellation(
        open.id,
        { outcome: 'CANCELLED', confirmedAt: now, effectiveAt: r.effectiveAt, refundAmount: toDecimal(r.refundAmount), refundDueAt: r.refundDueAt },
        tx,
      );
    });
    this.logger.log(`Abonelik iptal edildi (sub:${sub.id}) effectiveAt=${cancellation.effectiveAt?.toISOString() ?? '-'}`);
    return { cancellation: toCancellationDto(cancellation), status: 'CANCELLED' };
  }

  async abandon(userId: string, now: Date = new Date()): Promise<BootstrapSub> {
    const sub = await this.subscriptions.requireForUser(userId);
    await this.repo.transaction(async (tx) => {
      await this.repo.lockSubscription(sub.id, tx);
      const open = await this.requireOpen(sub, tx);
      assertOr409(cancellationMachine, open.outcome as CancelOutcome, 'ABANDONED');
      await this.repo.updateCancellation(open.id, { outcome: 'ABANDONED', confirmedAt: now }, tx);
      if (sub.status === 'CANCEL_REQUESTED') {
        assertOr409(subscriptionMachine, 'CANCEL_REQUESTED', 'ACTIVE');
        await this.repo.updateSubscription(sub.id, { status: 'ACTIVE', cancelRequestedAt: null }, tx);
        await this.repo.addEvent({ subscriptionId: sub.id, cycleId: null, type: 'RESUMED', actor: ACTOR.USER, data: { cancellationId: open.id, abandoned: true }, at: now }, tx);
      }
    });
    return this.subscriptions.buildBootstrapSub((await this.repo.findSubscriptionById(sub.id))!, now);
  }

  private async requireOpen(sub: SubscriptionRecord, tx: Parameters<SubscriptionsRepository['findOpenCancellation']>[1]): Promise<CancellationRecord> {
    const open = await this.repo.findOpenCancellation(sub.id, tx);
    if (!open) throw conflict(SUB_ERRORS.NO_OPEN_CANCELLATION, 'Açık bir iptal akışı yok');
    return open;
  }
}
