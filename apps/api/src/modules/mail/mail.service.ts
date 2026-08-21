import { Injectable, Logger } from '@nestjs/common';
import type { MailLogList, MailTestResult } from '@bagdam/shared';
import { MailStatus } from '@prisma/client';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { resolve } from 'path';
import {
  isMailDisabled,
  MAIL_LOG_LIMITS,
  MAIL_LOGS_DEFAULT_LIMIT,
  MAIL_PREVIEW_DIR,
  MAIL_PREVIEW_ERROR_PREFIX,
  MAIL_PURGE_BATCH_SIZE,
  MAIL_PURGE_MAX_ROUNDS,
  maskEmail,
} from './mail.constants';
import { previewPathOf, toMailLogItem } from './mail.mapper';
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

  /**
   * F10 — TEKİL gönderim: (templateSlug, entityId) için daha önce QUEUED/SENT/SKIPPED bir MailLog satırı varsa hiç
   * göndermez (aynı cycle için ikinci kesim hatırlatması yok). Yalnız FAILED satır varsa yeniden dener.
   * `entityId` zorunludur (tekillik anahtarı); `skipped:true` = zaten gönderilmiş.
   */
  async sendOnce(input: MailSendInput & { entityId: string }): Promise<MailSendResult & { skipped: boolean }> {
    const templateSlug = clip(input.templateSlug, MAIL_LOG_LIMITS.templateSlug);
    const entityId = clip(input.entityId, MAIL_LOG_LIMITS.entityId);
    const existing = await this.safeLog(() => this.repo.findByEntity(templateSlug, entityId));
    if (existing && existing.status !== MailStatus.FAILED) {
      return {
        logId: existing.id,
        status: existing.status,
        messageId: existing.messageId,
        previewPath: previewPathOf(existing.error),
        error: existing.error,
        skipped: true,
      };
    }
    const result = await this.send({ ...input, entityId });
    return { ...result, skipped: false };
  }

  /**
   * F10 `kvkk:purge` — `before` anından eski MailLog satırlarını siler; DISABLE_MAIL önizleme dosyaları
   * (`preview:<yol>`) da diskten kaldırılır. Toplu (batch) çalışır; dosya silme hatası satırı engellemez.
   */
  async purgeLogsOlderThan(before: Date, batchSize = MAIL_PURGE_BATCH_SIZE, maxRounds = MAIL_PURGE_MAX_ROUNDS): Promise<{ deleted: number; previewsDeleted: number }> {
    let deleted = 0;
    let previewsDeleted = 0;
    for (let round = 0; round < maxRounds; round++) {
      const rows = await this.repo.findOlderThan(before, batchSize);
      if (rows.length === 0) break;
      for (const row of rows) {
        const preview = previewPathOf(row.error);
        if (!preview) continue;
        try {
          await unlink(preview);
          previewsDeleted++;
        } catch {
          // dosya yoksa/erişilemiyorsa satır yine silinir
        }
      }
      deleted += await this.repo.deleteByIds(rows.map((r) => r.id));
      if (rows.length < batchSize) break;
    }
    if (deleted > 0) this.logger.log(`kvkk:purge — ${deleted} MailLog satırı silindi (${previewsDeleted} önizleme dosyası)`);
    return { deleted, previewsDeleted };
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
