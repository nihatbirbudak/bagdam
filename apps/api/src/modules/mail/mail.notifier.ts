import { Injectable, Logger } from '@nestjs/common';
import { DELIVERY_DAY_LABELS, formatMoneyTr, type DeliveryDay, type NotifierEvent } from '@bagdam/shared';
import { SettingsService } from '../settings/settings.service';
import { formatIstanbul } from './mail-templates.render';
import { maskEmail, webUrl } from './mail.constants';
import { MailService } from './mail.service';
import type { Notifier, NotifierCycle, NotifierOrder, NotifierPayloads } from './notifier.interface';

/**
 * MailNotifier — Notifier'ın e-posta uygulaması: olay → `mail.<slug>` şablonu + alıcı + değişkenler.
 *  - customer.*          → kullanıcıya (entityId = userId: aynı şablon+kullanıcı satırı yeniden gönderimde güncellenir)
 *  - wholesale.new-lead  → yöneticiye: Setting `site.contactEmail` (yoksa .env SMTP_FROM); ikisi de yoksa atlanır + log
 *  - order.paid          → müşteriye (entityId = orderId): sipariş özeti + yasal belge kopyası bağlantıları (F8)
 *  - order.shipped / order.delivered / order.delivery-failed → müşteriye (entityId = orderId; F10)
 *  - cycle.charged / cycle.payment-failed / cycle.awaiting-payment / subscription.cutoff-reminder /
 *    subscription.cancelled / subscription.past-due → abonelik motoru olayları (F10; SubscriptionNotifier zenginleştirir)
 * Para alanları tr-TR metne, anlar Europe/Istanbul metnine burada çevrilir (şablon yalnız basar).
 * `notify` asla fırlatmaz (MailService zaten yutar; beklenmeyen hata burada da loglanır).
 */
@Injectable()
export class MailNotifier implements Notifier {
  private readonly logger = new Logger(MailNotifier.name);

  constructor(
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  async notify<E extends NotifierEvent>(event: E, payload: NotifierPayloads[E]): Promise<void> {
    try {
      await this.dispatch(event, payload);
    } catch (err) {
      this.logger.error(`Bildirim işlenemedi (${event}): ${(err as Error).message}`);
    }
  }

  private async dispatch<E extends NotifierEvent>(event: E, payload: NotifierPayloads[E]): Promise<void> {
    switch (event) {
      case 'customer.welcome': {
        const p = payload as NotifierPayloads['customer.welcome'];
        await this.mail.send({ to: p.user.email, templateSlug: 'welcome', entityId: p.user.id, vars: { user: p.user } });
        return;
      }
      case 'customer.verify': {
        const p = payload as NotifierPayloads['customer.verify'];
        await this.mail.send({ to: p.user.email, templateSlug: 'verify', entityId: p.user.id, vars: { user: p.user, verifyUrl: p.verifyUrl } });
        return;
      }
      case 'customer.reset': {
        const p = payload as NotifierPayloads['customer.reset'];
        await this.mail.send({
          to: p.user.email,
          templateSlug: 'reset',
          entityId: p.user.id,
          vars: { user: p.user, resetUrl: p.resetUrl, expiresMinutes: p.expiresMinutes },
        });
        return;
      }
      case 'customer.password-changed': {
        const p = payload as NotifierPayloads['customer.password-changed'];
        await this.mail.send({
          to: p.user.email,
          templateSlug: 'password-changed',
          entityId: p.user.id,
          vars: { user: p.user, changedAt: formatIstanbul(p.changedAt) },
        });
        return;
      }
      case 'wholesale.new-lead': {
        const p = payload as NotifierPayloads['wholesale.new-lead'];
        const to = await this.adminEmail();
        if (!to) {
          this.logger.warn(`Toptan talebi bildirimi atlandı: yönetici e-postası yok (Setting site.contactEmail / SMTP_FROM) — lead ${p.lead.id}`);
          return;
        }
        await this.mail.send({
          to,
          templateSlug: 'wholesale-lead',
          entityId: p.lead.id,
          vars: { lead: { ...p.lead, createdAt: formatIstanbul(p.lead.createdAt) } },
        });
        this.logger.log(`Toptan talebi bildirimi: ${p.lead.id} → ${maskEmail(to)}`);
        return;
      }
      case 'order.paid': {
        const p = payload as NotifierPayloads['order.paid'];
        await this.sendOrderMail('order-paid', p.order, {});
        return;
      }

      // ── F10: teslimat olayları ────────────────────────────────────────────
      case 'order.shipped': {
        const p = payload as NotifierPayloads['order.shipped'];
        await this.sendOrderMail('order-shipped', p.order, {});
        return;
      }
      case 'order.delivered': {
        const p = payload as NotifierPayloads['order.delivered'];
        await this.sendOrderMail('order-delivered', p.order, {});
        return;
      }
      case 'order.delivery-failed': {
        const p = payload as NotifierPayloads['order.delivery-failed'];
        await this.sendOrderMail('order-delivery-failed', p.order, { reason: p.reason ?? '' });
        return;
      }

      // ── F10: abonelik motoru olayları ─────────────────────────────────────
      case 'cycle.charged': {
        const p = payload as NotifierPayloads['cycle.charged'];
        await this.sendCycleMail('cycle-charged', p.cycle, p.cycle.cycleId, {
          amountText: formatMoneyTr(p.amount),
          orderNo: p.orderNo,
          isDelta: p.isDelta,
        });
        return;
      }
      case 'cycle.payment-failed': {
        const p = payload as NotifierPayloads['cycle.payment-failed'];
        await this.sendCycleMail('cycle-payment-failed', p.cycle, `${p.cycle.cycleId}:${p.attemptNo}`, {
          amountText: formatMoneyTr(p.amount),
          failure: p.failure ?? '',
          hasRetry: p.nextRetryAt !== null,
          isDelta: p.isDelta,
          nextRetryText: p.nextRetryAt ? formatIstanbul(p.nextRetryAt) : '',
          cardUrl: `${webUrl()}/uyelik.html`,
        });
        return;
      }
      case 'cycle.awaiting-payment': {
        const p = payload as NotifierPayloads['cycle.awaiting-payment'];
        await this.sendCycleMail('cycle-awaiting-payment', p.cycle, `${p.cycle.cycleId}:${p.attemptNo}`, {
          amountText: formatMoneyTr(p.amount),
          payUrl: p.payUrl,
          expiresAtText: formatIstanbul(p.expiresAt),
        });
        return;
      }
      case 'subscription.cutoff-reminder': {
        // Cycle başına TEK hatırlatma — MailLog (templateSlug, entityId=cycleId) tekilliği (sendOnce).
        const p = payload as NotifierPayloads['subscription.cutoff-reminder'];
        const vars = await this.cycleVars(p.cycle, { cutoffAtText: formatIstanbul(p.cutoffAt) });
        const result = await this.mail.sendOnce({
          to: p.cycle.user.email,
          templateSlug: 'cutoff-reminder',
          entityId: p.cycle.cycleId,
          vars: { user: p.cycle.user, cycle: vars },
        });
        if (result.skipped) this.logger.log(`Kesim hatırlatması zaten gönderilmiş (cycle ${p.cycle.cycleId}) — atlandı`);
        return;
      }
      case 'subscription.cancelled': {
        const p = payload as NotifierPayloads['subscription.cancelled'];
        const base = webUrl();
        await this.mail.send({
          to: p.user.email,
          templateSlug: 'subscription-cancelled',
          entityId: p.subscriptionId,
          vars: {
            user: p.user,
            sub: {
              tierName: p.tierName,
              effectiveAtText: formatIstanbul(p.effectiveAt),
              hasLastBox: p.lastBoxOn !== null,
              lastBoxText: p.lastBoxOn ? formatTrDate(p.lastBoxOn) : '',
              hasRefund: p.refundAmount > 0,
              refundAmountText: formatMoneyTr(p.refundAmount),
              refundDueAtText: p.refundDueAt ? formatTrDate(isoDateOf(p.refundDueAt)) : '',
              accountUrl: `${base}/uyelik.html`,
            },
          },
        });
        this.logger.log(`Abonelik iptali e-postası: ${p.subscriptionId} → ${maskEmail(p.user.email)}`);
        return;
      }
      case 'subscription.past-due': {
        const p = payload as NotifierPayloads['subscription.past-due'];
        const base = webUrl();
        await this.mail.send({
          to: p.user.email,
          templateSlug: 'subscription-past-due',
          entityId: `${p.subscriptionId}:${p.failedCycles}`,
          vars: {
            user: p.user,
            sub: { tierName: p.tierName, failedCycles: p.failedCycles, cardUrl: `${base}/uyelik.html`, accountUrl: `${base}/uyelik.html` },
          },
        });
        this.logger.log(`Abonelik askıda e-postası: ${p.subscriptionId} → ${maskEmail(p.user.email)}`);
        return;
      }
      default:
        this.logger.warn(`Bilinmeyen bildirim olayı: ${String(event)}`);
    }
  }

  // ── Ortak gönderim yardımcıları ─────────────────────────────────────────────

  /** Sipariş şablonları (order-paid/-shipped/-delivered/-delivery-failed) — aynı `order` bağlamı, entityId = orderId. */
  private async sendOrderMail(slug: string, order: NotifierOrder, extra: Record<string, unknown>): Promise<void> {
    const vars = { ...(await this.orderVars(order)), ...extra };
    await this.mail.send({ to: order.customerEmail, templateSlug: slug, entityId: order.id, vars: { order: vars } });
    this.logger.log(`${slug}: #${order.orderNo} → ${maskEmail(order.customerEmail)}`);
  }

  /** Abonelik kutusu şablonları — `cycle` + `user` bağlamı; entityId çağrıya göre (tahsilat: cycleId, dunning: cycleId:deneme). */
  private async sendCycleMail(slug: string, cycle: NotifierCycle, entityId: string, extra: Record<string, unknown>): Promise<void> {
    const vars = await this.cycleVars(cycle, extra);
    await this.mail.send({ to: cycle.user.email, templateSlug: slug, entityId, vars: { user: cycle.user, cycle: vars } });
    this.logger.log(`${slug}: cycle ${cycle.cycleId} → ${maskEmail(cycle.user.email)}`);
  }

  /** NotifierOrder → şablon bağlamı (para/tarih metinleri + satırlar + yasal belge bağlantıları). */
  private async orderVars(order: NotifierOrder): Promise<Record<string, unknown>> {
    const money = (n: number): string => formatMoneyTr(n);
    return {
      ...order,
      deliveryWindow: await this.deliveryWindow(),
      paidAtText: formatIstanbul(order.paidAt),
      deliveryOnText: formatTrDate(order.deliveryOn),
      deliveryDayLabel: labelOfDeliveryDay(order.deliveryDay),
      subtotalText: money(order.subtotal),
      discountTotalText: money(order.discountTotal),
      shippingFeeText: money(order.shippingFee),
      vatTotalText: money(order.vatTotal),
      grandTotalText: money(order.grandTotal),
      hasDiscount: order.discountTotal > 0,
      hasShipping: order.shippingFee > 0,
      lines: order.lines.map((l) => ({ ...l, qtyText: formatQty(l.qty, l.unit, l.kind), lineTotalText: money(l.lineTotal) })),
    };
  }

  /** NotifierCycle → şablon bağlamı (kutu içeriği + teslimat metinleri + bağlantılar). */
  private async cycleVars(cycle: NotifierCycle, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      cycleNo: cycle.cycleNo,
      tierName: cycle.tierName,
      deliveryOnText: formatTrDate(cycle.deliveryOn),
      deliveryDayLabel: labelOfDeliveryDay(cycle.deliveryDay),
      deliveryWindow: await this.deliveryWindow(),
      addressLine: cycle.addressLine,
      zoneName: cycle.zoneName,
      items: cycle.items.map((i) => ({ name: i.name, pref: i.pref, qtyText: formatQty(i.qty, i.unit, i.source) })),
      accountUrl: cycle.accountUrl,
      boxUrl: cycle.boxUrl,
      ...extra,
    };
  }

  /** Setting `commerce.deliveryWindow` (okunamazsa boş metin — şablon satırı boş kalır, gönderim sürer). */
  private async deliveryWindow(): Promise<string> {
    try {
      return (await this.settings.getCommerce()).deliveryWindow;
    } catch (err) {
      this.logger.warn(`commerce.deliveryWindow okunamadı: ${(err as Error).message}`);
      return '';
    }
  }

  /** Yönetici bildirim adresi: Setting site.contactEmail → .env SMTP_FROM → null. */
  private async adminEmail(): Promise<string | null> {
    const site = await this.settings.getSite().catch(() => null);
    const contact = site?.contactEmail?.trim();
    if (contact) return contact;
    const from = (process.env.SMTP_FROM ?? '').trim();
    return from || null;
  }
}

/** DeliveryDay enum/slug → Türkçe etiket ("Salı"); bilinmeyen değer olduğu gibi. */
function labelOfDeliveryDay(day: string): string {
  return (DELIVERY_DAY_LABELS as Record<string, string>)[day as DeliveryDay] ?? day;
}

/** Date → YYYY-MM-DD (Europe/Istanbul takvim günü). */
function isoDateOf(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** YYYY-MM-DD → "02.03.2027" (takvim günü; TZ'siz). Biçimsizse olduğu gibi. */
export function formatTrDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : isoDate;
}

/** Satır miktarı metni: BOX "1 kutu"; birim yoksa "2 adet"; birim varsa "2 × demet" / "0,25 × kg". */
export function formatQty(qty: number, unit: string | null, kind: string): string {
  const n = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 1000) / 1000).replace('.', ',');
  if (kind === 'BOX') return '1 kutu';
  if (!unit) return `${n} adet`;
  return `${n} × ${unit}`;
}

