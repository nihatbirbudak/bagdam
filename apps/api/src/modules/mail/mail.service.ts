import { Injectable, Logger } from '@nestjs/common';
import type { MailLogList, MailTestResult } from '@bagdam/shared';
import { MailStatus } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { isMailDisabled, MAIL_LOG_LIMITS, MAIL_LOGS_DEFAULT_LIMIT, MAIL_PREVIEW_DIR, MAIL_PREVIEW_ERROR_PREFIX, maskEmail } from './mail.constants';
import { toMailLogItem } from './mail.mapper';
import { MailRepository, type MailLogRecord } from './mail.repository';
import { MailTemplateError, MailTemplateRenderer } from './mail-templates.render';
import { MailTransportError, SmtpTransport } from './mail.transport';
import type { MailSendInput, MailSendResult } from './mail.types';
import type { MailLogQueryDto } from './dto/mail-log-query.dto';

/** VarChar kolonuna sığdır. */
function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * MailService — tek gönderim noktası (ADR-0014): şablon (SiteContent `mail.<slug>`, Handlebars) → MailLog satırı →
 * DISABLE_MAIL ise önizleme dosyası + SKIPPED, değilse SMTP (Setting mail.* → .env SMTP_*) → SENT/FAILED.
 *  - Asla fırlatmaz: her sonuç MailLog'a yazılır ve `MailSendResult` olarak döner (iş akışı bozulmaz; Notifier de yutar).
 *  - `entityId` verilirse (templateSlug, entityId) satırı tekildir → yeniden gönderim günceller (bkz. MailRepository.open).
 *  - Konsol loglarında e-posta maskelenir (ADR-0015); MailLog.to tam (operasyon).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly repo: MailRepository,
    private readonly renderer: MailTemplateRenderer,
    private readonly transport: SmtpTransport,
  ) {}

  async send(input: MailSendInput): Promise<MailSendResult> {
    const now = new Date();
    const to = clip(input.to.trim(), MAIL_LOG_LIMITS.to);
    const templateSlug = clip(input.templateSlug, MAIL_LOG_LIMITS.templateSlug);
    const entityId = input.entityId ? clip(input.entityId, MAIL_LOG_LIMITS.entityId) : null;

    // 1) Şablon render — başarısızsa FAILED satırı (konu: şablon adı)
    let subject: string;
    let html: string;
    try {
      const rendered = await this.renderer.render(input.templateSlug, input.vars ?? {});
      subject = clip(rendered.subject, MAIL_LOG_LIMITS.subject);
      html = rendered.html;
    } catch (err) {
      const message = err instanceof MailTemplateError ? `${err.code}: ${err.message}` : `MAIL_TEMPLATE_RENDER: ${(err as Error).message}`;
      this.logger.error(`E-posta render edilemedi (${templateSlug} → ${maskEmail(to)}): ${message}`);
      const row = await this.safeLog(() => this.repo.open({ to, subject: `[şablon] ${templateSlug}`, templateSlug, entityId }, now));
      if (!row) return { logId: '', status: MailStatus.FAILED, messageId: null, previewPath: null, error: message };
      const finished = await this.safeLog(() => this.repo.finish(row.id, { status: MailStatus.FAILED, error: message }));
      return this.toResult(finished ?? row, MailStatus.FAILED, null, null, message);
    }

    // 2) MailLog (QUEUED)
    const row = await this.safeLog(() => this.repo.open({ to, subject, templateSlug, entityId }, now));
    if (!row) {
      // MailLog yazılamıyorsa (DB sorunu) gönderimi de yapma — izlenemeyen e-posta yok
      return { logId: '', status: MailStatus.FAILED, messageId: null, previewPath: null, error: 'MAIL_LOG_WRITE_FAILED' };
    }

    // 3) DISABLE_MAIL → önizleme dosyası + SKIPPED
    if (isMailDisabled()) {
      const previewPath = await this.writePreview(row.id, { to, subject, html, templateSlug });
      const error = previewPath ? `${MAIL_PREVIEW_ERROR_PREFIX}${previewPath}` : 'DISABLE_MAIL=true (önizleme yazılamadı)';
      const finished = await this.safeLog(() => this.repo.finish(row.id, { status: MailStatus.SKIPPED, error }));
      this.logger.log(`E-posta atlandı (DISABLE_MAIL): ${templateSlug} → ${maskEmail(to)}${previewPath ? ` · önizleme ${previewPath}` : ''}`);
      return this.toResult(finished ?? row, MailStatus.SKIPPED, null, previewPath, error);
    }

    // 4) SMTP gönderimi
    try {
      const from = (await this.transport.defaultFrom()) ?? '';
      const { messageId } = await this.transport.send({ to, subject, html, from });
      const sentAt = new Date();
      const finished = await this.safeLog(() =>
        this.repo.finish(row.id, { status: MailStatus.SENT, messageId: messageId ? clip(messageId, MAIL_LOG_LIMITS.messageId) : null, sentAt }),
      );
      this.logger.log(`E-posta gönderildi: ${templateSlug} → ${maskEmail(to)}${messageId ? ` (${messageId})` : ''}`);
      return this.toResult(finished ?? row, MailStatus.SENT, messageId ?? null, null, null);
    } catch (err) {
      const message = err instanceof MailTransportError ? `${err.code}: ${err.message}` : `MAIL_SEND_FAILED: ${(err as Error).message}`;
      this.logger.error(`E-posta gönderilemedi (${templateSlug} → ${maskEmail(to)}): ${message}`);
      const finished = await this.safeLog(() => this.repo.finish(row.id, { status: MailStatus.FAILED, error: clip(message, 2000) }));
      return this.toResult(finished ?? row, MailStatus.FAILED, null, null, message);
    }
  }

  /** Admin `POST /admin/settings/mail/test {to}` → `mail.test` şablonu; DISABLE_MAIL'de SKIPPED + previewPath. */
  async sendTest(to: string): Promise<MailTestResult> {
    const result = await this.send({ to, templateSlug: 'test', vars: { sentAt: new Date().toISOString() } });
    return { logId: result.logId, status: result.status, messageId: result.messageId, previewPath: result.previewPath, error: result.error };
  }

  /** Admin `GET /admin/mail-logs?page&limit&status&to` → {items,total,page,limit}. */
  async listLogs(query: MailLogQueryDto): Promise<MailLogList> {
    const page = query.page ?? 1;
    const limit = query.limit ?? MAIL_LOGS_DEFAULT_LIMIT;
    const { rows, total } = await this.repo.list({ status: query.status, to: query.to || undefined }, (page - 1) * limit, limit);
    return { items: rows.map((r) => toMailLogItem(r)), total, page, limit };
  }

  // ── Yardımcılar ─────────────────────────────────────────────────────────────

  /** `logs/mail/<id>.html` — başlık yorumu (to/subject/template) + gövde; dizin yoksa oluşturulur. Hata → null. */
  private async writePreview(id: string, mail: { to: string; subject: string; html: string; templateSlug: string }): Promise<string | null> {
    try {
      await mkdir(MAIL_PREVIEW_DIR, { recursive: true });
      const file = resolve(MAIL_PREVIEW_DIR, `${id}.html`);
      const header =
        `<!-- bagdam mail preview · template: ${mail.templateSlug} · to: ${mail.to} · subject: ${mail.subject.replace(/-->/g, '--&gt;')} · at: ${new Date().toISOString()} -->\n` +
        `<!-- subject: ${mail.subject.replace(/-->/g, '--&gt;')} -->\n`;
      await writeFile(file, header + mail.html, 'utf8');
      return file;
    } catch (err) {
      this.logger.warn(`E-posta önizlemesi yazılamadı (${id}): ${(err as Error).message}`);
      return null;
    }
  }

  private async safeLog<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(`MailLog yazılamadı: ${(err as Error).message}`);
      return null;
    }
  }

  private toResult(row: MailLogRecord, status: MailStatus, messageId: string | null, previewPath: string | null, error: string | null): MailSendResult {
    return { logId: row.id, status, messageId, previewPath, error };
  }
}
