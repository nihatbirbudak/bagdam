import { describe, expect, it } from 'vitest';
import {
  customerDisplayName,
  customerToDraft,
  isCustomerAnonymized,
  isCustomerDraftDirty,
  normalizeCustomerDetail,
  normalizeCustomerListItem,
  toCustomerPatch,
  validateCustomerDraft,
} from './customers';

describe('customers — normalize', () => {
  it('düz satırı okur; eksik alanlar güvenli varsayılan alır', () => {
    const c = normalizeCustomerListItem({ id: 'u1', email: 'a@b.co', createdAt: '2026-08-20T10:00:00.000Z' });
    expect(c).toEqual({
      id: 'u1',
      email: 'a@b.co',
      name: null,
      phone: null,
      role: 'CUSTOMER',
      isActive: true,
      emailVerifiedAt: null,
      lastLoginAt: null,
      anonymizedAt: null,
      createdAt: '2026-08-20T10:00:00.000Z',
      orderCount: undefined,
      lastOrderAt: undefined,
      subscriptionStatus: undefined,
    });
  });

  it('`{user:{…}}` sarmalını açar; id/email yoksa null', () => {
    expect(normalizeCustomerListItem({ user: { id: 'u2', email: 'x@y.z', role: 'STAFF', isActive: false } })?.role).toBe('STAFF');
    expect(normalizeCustomerListItem({ name: 'yok' })).toBeNull();
    expect(normalizeCustomerListItem(null)).toBeNull();
  });

  it('detay: adres (`address` ya da `addresses[0]`), onaylar, audit (`{items}`), siparişler', () => {
    const d = normalizeCustomerDetail({
      user: { id: 'u1', email: 'a@b.co', name: 'Ayşe', marketingOptIn: true, createdAt: '2026-08-20T10:00:00.000Z' },
      addresses: [{ id: 'ad1', fullName: 'Ayşe Y', phone: '0532', line: 'Urla', zone: { id: 'z1', name: 'Urla', slug: 'urla' }, zip: null }],
      consents: [{ id: 'c1', kind: 'KVKK_ACK', granted: true, document: { id: 'd1', slug: 'kvkk', title: 'KVKK', version: 2 }, createdAt: '2026-08-20T10:00:00.000Z' }],
      audit: { items: [{ id: 'a1', action: 'REGISTER', module: 'auth', summary: null, createdAt: '2026-08-20T10:00:00.000Z' }] },
      orders: { items: [], total: 0 },
    });
    expect(d).not.toBeNull();
    expect(d!.marketingOptIn).toBe(true);
    expect(d!.address).toMatchObject({ id: 'ad1', zoneId: 'z1', zoneName: 'Urla', zoneSlug: 'urla' });
    expect(d!.consents[0]).toMatchObject({ kind: 'KVKK_ACK', documentId: 'd1', documentSlug: 'kvkk', documentTitle: 'KVKK', documentVersion: 2 });
    expect(d!.audit).toHaveLength(1);
    expect(d!.orders).toEqual({ items: [], total: 0 });
  });

  it('detay: adres yok / onay yok / audit dizi → boş güvenli', () => {
    const d = normalizeCustomerDetail({ id: 'u1', email: 'a@b.co', address: null, audit: [] });
    expect(d!.address).toBeNull();
    expect(d!.consents).toEqual([]);
    expect(d!.audit).toEqual([]);
    expect(d!.orders).toEqual({ items: [], total: 0 });
  });
});

describe('customers — görüntü ve form', () => {
  it('anonimleştirilmiş: anonymizedAt ya da @anon.local', () => {
    expect(isCustomerAnonymized({ anonymizedAt: '2026-08-20T10:00:00.000Z', email: 'a@b.co' })).toBe(true);
    expect(isCustomerAnonymized({ anonymizedAt: null, email: 'anon+u1@anon.local' })).toBe(true);
    expect(isCustomerAnonymized({ anonymizedAt: null, email: 'a@b.co' })).toBe(false);
    expect(customerDisplayName({ name: '  ', email: 'a@b.co' })).toBe('a@b.co');
    expect(customerDisplayName({ name: 'Ayşe', email: 'a@b.co' })).toBe('Ayşe');
  });

  it('taslak → yalnız değişen alanlar PATCH; boş → null', () => {
    const initial = customerToDraft({ name: 'Ayşe', phone: '0532 000 00 00', isActive: true });
    expect(toCustomerPatch(initial, { ...initial })).toEqual({});
    expect(isCustomerDraftDirty(initial, { ...initial })).toBe(false);
    expect(toCustomerPatch(initial, { name: '', phone: '0532 000 00 00', isActive: false })).toEqual({ name: null, isActive: false });
    expect(toCustomerPatch(initial, { name: 'Ayşe ', phone: '', isActive: true })).toEqual({ phone: null });
  });

  it('doğrulama: ad ≤120, telefon biçimi', () => {
    expect(validateCustomerDraft({ name: 'a'.repeat(121), phone: '', isActive: true })).toHaveProperty('name');
    expect(validateCustomerDraft({ name: '', phone: '123', isActive: true })).toHaveProperty('phone');
    expect(validateCustomerDraft({ name: '', phone: '+90 532 000 00 00', isActive: true })).toEqual({});
    expect(validateCustomerDraft({ name: '', phone: '', isActive: true })).toEqual({});
  });
});
