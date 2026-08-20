import { describe, expect, it } from 'vitest';
import { describeMailSendResult, mailErrorText, mailStatusLabel, normalizeMailLog, parseMailPreview } from './mailLogs';

describe('mailLogs — yardımcılar', () => {
  it('preview:<dosya> ayrıştırma', () => {
    expect(parseMailPreview('preview:apps/api/logs/mail/abc.html')).toBe('apps/api/logs/mail/abc.html');
    expect(parseMailPreview('preview:  ')).toBeNull();
    expect(parseMailPreview('SMTP timeout')).toBeNull();
    expect(parseMailPreview(null)).toBeNull();
    expect(mailErrorText('preview:x.html')).toBeNull();
    expect(mailErrorText('SMTP timeout')).toBe('SMTP timeout');
  });

  it('durum etiketi shared MAIL_STATUS_LABELS', () => {
    expect(mailStatusLabel('SENT')).toBe('Gönderildi');
    expect(mailStatusLabel('SKIPPED')).toMatch(/Atlandı/);
    expect(mailStatusLabel('BILINMEYEN')).toBe('BILINMEYEN');
    expect(mailStatusLabel(null)).toBe('—');
  });

  it('normalizeMailLog: eksik alanlar güvenli; id yoksa null', () => {
    expect(normalizeMailLog({ id: 'm1', to: 'a@b.co', status: 'SENT' })).toEqual({
      id: 'm1',
      to: 'a@b.co',
      subject: '',
      templateSlug: '',
      entityId: null,
      status: 'SENT',
      error: null,
      messageId: null,
      createdAt: '',
      sentAt: null,
    });
    expect(normalizeMailLog({ to: 'x' })).toBeNull();
  });

  it('describeMailSendResult: SENT / SKIPPED+preview / FAILED / tanınmayan', () => {
    expect(describeMailSendResult({ status: 'SENT', to: 'a@b.co' })).toMatchObject({ tone: 'success', status: 'SENT' });
    const skipped = describeMailSendResult({ status: 'SKIPPED', error: 'preview:logs/mail/m1.html' });
    expect(skipped.tone).toBe('info');
    expect(skipped.preview).toBe('logs/mail/m1.html');
    expect(skipped.message).toContain('logs/mail/m1.html');
    const failed = describeMailSendResult({ status: 'FAILED', error: 'ECONNREFUSED' });
    expect(failed.tone).toBe('error');
    expect(failed.message).toContain('ECONNREFUSED');
    expect(describeMailSendResult({ message: 'Gönderildi (id m2)' })).toMatchObject({ tone: 'success', message: 'Gönderildi (id m2)' });
    expect(describeMailSendResult(undefined)).toMatchObject({ tone: 'success' });
  });
});
