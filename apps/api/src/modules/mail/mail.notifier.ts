import { Injectable, Logger } from '@nestjs/common';
import type { NotifierEvent } from '@bagdam/shared';
import { SettingsService } from '../settings/settings.service';
import { formatIstanbul } from './mail-templates.render';
import { maskEmail } from './mail.constants';
import { MailService } from './mail.service';
import type { Notifier, NotifierPayloads } from './notifier.interface';

/**
 * MailNotifier — Notifier'ın e-posta uygulaması: olay → `mail.<slug>` şablonu + alıcı + değişkenler.
 *  - customer.*          → kullanıcıya (entityId = userId: aynı şablon+kullanıcı satırı yeniden gönderimde güncellenir)
 *  - wholesale.new-lead  → yöneticiye: Setting `site.contactEmail` (yoksa .env SMTP_FROM); ikisi de yoksa atlanır + log
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
      default:
        this.logger.warn(`Bilinmeyen bildirim olayı: ${String(event)}`);
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
