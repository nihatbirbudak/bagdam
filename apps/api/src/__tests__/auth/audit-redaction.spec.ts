// AuditLogInterceptor redaksiyonu (ADR-0015): e-posta/telefon/adres/parola alanları `[redacted]`; DB gerekmez.
import { REDACTED, redactForAudit } from '../../common/interceptors/audit-log.interceptor';

describe('redactForAudit — audit snapshot redaksiyonu', () => {
  it('hassas anahtarları (e-posta, telefon, adres, parola, token) her derinlikte redakte eder', () => {
    const input = {
      name: 'İncir',
      email: 'kisi@example.com',
      phone: '+90 555 000 00 00',
      password: 'gizli',
      newPassword: 'gizli2',
      refreshTokenHash: 'abc',
      apiKey: 'k',
      address: { line: 'Sokak 1', fullName: 'Ad Soyad', zip: '35430', zoneId: 'z1' },
      items: [{ phone: '1', qty: 2 }],
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
      price: 12.5,
      nested: { deeper: { Email: 'x@y.z', ok: true } },
    };
    const out = redactForAudit(input) as Record<string, unknown>;
    expect(out.name).toBe('İncir');
    expect(out.email).toBe(REDACTED);
    expect(out.phone).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.newPassword).toBe(REDACTED);
    expect(out.refreshTokenHash).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    // `address` anahtarı bütünüyle redakte edilir (iç alanlara inilmez)
    expect(out.address).toBe(REDACTED);
    expect(out.items).toEqual([{ phone: REDACTED, qty: 2 }]);
    expect(out.createdAt).toBe('2026-08-20T10:00:00.000Z');
    expect(out.price).toBe(12.5);
    expect(out.nested).toEqual({ deeper: { Email: REDACTED, ok: true } });
    // Girdi değişmez
    expect(input.email).toBe('kisi@example.com');
  });

  it('ilkel/boş değerleri olduğu gibi döndürür, uzun dizgeleri kırpar', () => {
    expect(redactForAudit(null)).toBeNull();
    expect(redactForAudit(undefined)).toBeUndefined();
    expect(redactForAudit('abc')).toBe('abc');
    expect(redactForAudit(3)).toBe(3);
    const long = 'x'.repeat(5000);
    const clipped = redactForAudit(long) as string;
    expect(clipped.length).toBeLessThan(4100);
    expect(clipped.endsWith('…')).toBe(true);
  });
});
