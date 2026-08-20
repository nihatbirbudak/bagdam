import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { ContentModule } from '../content/content.module';
import { SettingsModule } from '../settings/settings.module';
import { MailAdminController } from './mail-admin.controller';
import { MailTemplateRenderer } from './mail-templates.render';
import { MailNotifier } from './mail.notifier';
import { MailRepository } from './mail.repository';
import { MailService } from './mail.service';
import { SmtpTransport } from './mail.transport';
import { NOTIFIER } from './notifier.interface';

/**
 * MailModule (F6, ADR-0014) — MailService (şablon SiteContent `mail.<slug>` → Handlebars → MailLog → SMTP/DISABLE_MAIL),
 * SmtpTransport (Setting mail.* → .env SMTP_*), MailNotifier (`NOTIFIER` token: iş modülleri olay bildirir),
 * MailAdminController (GET /admin/mail-logs · POST /admin/settings/mail/test).
 * Bağımlılıklar: ContentModule (şablon satırları + footer), SettingsModule (site/mail ayarları). Döngü yok:
 * AuthModule/WholesaleModule → MailModule → Content/Settings. CacheModule @Global (AppModule; testlerde register).
 */
@Module({
  imports: [PrismaModule, ContentModule, SettingsModule],
  controllers: [MailAdminController],
  providers: [MailRepository, MailTemplateRenderer, SmtpTransport, MailService, MailNotifier, { provide: NOTIFIER, useExisting: MailNotifier }],
  exports: [MailService, MailNotifier, NOTIFIER],
})
export class MailModule {}
