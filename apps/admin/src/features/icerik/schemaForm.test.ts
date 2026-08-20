import { describe, expect, it } from 'vitest';
import {
  fromFormState,
  inferSchemaFromValue,
  normalizeFeatured,
  normalizeSchema,
  toFormState,
  toSiteMediaPath,
  validateValues,
} from './schemaForm';

describe('schemaForm — şema normalizasyonu (A registry `name/itemFields` + shared `key/item`)', () => {
  it('A registry biçimini (name/itemFields/select options) normalize eder', () => {
    const fields = normalizeSchema({
      fields: [
        { name: 'eyebrow', label: 'Üst başlık', type: 'text', required: true },
        { name: 'title', label: 'Başlık', type: 'richtext' },
        { name: 'enabled', label: 'Göster', type: 'boolean' },
        { name: 'layout', label: 'Düzen', type: 'select', options: ['a', { value: 'b', label: 'B düzeni' }] },
        { name: 'items', label: 'Öğeler', type: 'list', itemFields: [{ name: 'q', type: 'text' }, { name: 'a', type: 'textarea' }] },
      ],
    });
    expect(fields.map((f) => f.name)).toEqual(['eyebrow', 'title', 'enabled', 'layout', 'items']);
    expect(fields[0].required).toBe(true);
    expect(fields[1].type).toBe('richtext');
    expect(fields[3].options).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'B düzeni' },
    ]);
    expect(fields[4].itemFields?.map((f) => f.name)).toEqual(['q', 'a']);
    expect(fields[4].itemFields?.[0].label).toBe('q');
  });

  it('shared/seed biçimini (key/item/html/featured) aynı normalize biçime çevirir', () => {
    const fields = normalizeSchema({
      fields: [
        { key: 'html', label: 'Metin (HTML)', type: 'html', required: true },
        { key: 'items', label: 'Öğeler', type: 'list', item: [{ key: 'icon', type: 'image' }, { key: 'label', type: 'text' }] },
        { key: 'featured', label: 'Öne çıkanlar', type: 'featured' },
      ],
    });
    expect(fields[0]).toMatchObject({ name: 'html', type: 'richtext', required: true });
    expect(fields[1].itemFields?.map((f) => f.type)).toEqual(['image', 'text']);
    expect(fields[2].type).toBe('featured');
  });

  it('bilinmeyen/eksik şema → boş; inferSchemaFromValue değerden alan türetir', () => {
    expect(normalizeSchema(null)).toEqual([]);
    expect(normalizeSchema({ nope: true })).toEqual([]);
    const inferred = inferSchemaFromValue({ title: 'x', count: 3, on: true, long: 'a'.repeat(200), html: '<b>x</b>', items: [{ a: '1', b: 2 }] });
    expect(inferred.map((f) => [f.name, f.type])).toEqual([
      ['title', 'text'],
      ['count', 'number'],
      ['on', 'boolean'],
      ['long', 'textarea'],
      ['html', 'richtext'],
      ['items', 'list'],
    ]);
    expect(inferSchemaFromValue([{ type: 'product', ref: 'x', order: 1 }])[0].type).toBe('featured');
    expect(inferSchemaFromValue([{ title: 'a' }])[0].type).toBe('list');
  });
});

describe('schemaForm — form durumu ↔ değer', () => {
  const fields = normalizeSchema({
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'count', type: 'number' },
      { name: 'enabled', type: 'boolean' },
      { name: 'faq', type: 'list', itemFields: [{ name: 'q', type: 'text', required: true }, { name: 'a', type: 'richtext' }] },
    ],
  });

  it('nesne kökü: eksik alanlar varsayılan, sayı metne ve geri', () => {
    const st = toFormState(fields, { title: 'Merhaba', count: 2.5, faq: [{ q: 'S?', a: '<p>C</p>' }] });
    expect(st.rootShape).toBe('object');
    expect(st.values).toEqual({ title: 'Merhaba', count: '2,5', enabled: false, faq: [{ q: 'S?', a: '<p>C</p>' }] });
    const back = fromFormState(fields, st);
    expect(back).toEqual({ title: 'Merhaba', count: 2.5, enabled: false, faq: [{ q: 'S?', a: '<p>C</p>' }] });
  });

  it('dizi kökü (home.pillars gibi) korunur: liste alanına eşlenir, geri dizi yazılır', () => {
    const pillars = normalizeSchema({ fields: [{ name: 'items', type: 'list', itemFields: [{ name: 'title', type: 'text' }, { name: 'text', type: 'textarea' }] }] });
    const st = toFormState(pillars, [{ title: 'A', text: 'a' }, { title: 'B', text: 'b', extra: 'x' }]);
    expect(st.rootShape).toBe('array');
    expect(st.rootListField).toBe('items');
    expect(fromFormState(pillars, st)).toEqual([
      { title: 'A', text: 'a' },
      { title: 'B', text: 'b' },
    ]);
  });

  it('featured: sıraya göre dizilir, order yeniden numaralanır, {items:[…]} biçimi de okunur', () => {
    expect(normalizeFeatured([{ type: 'tier', ref: 'sezon', order: 3 }, { type: 'product', ref: 'zeytinyagi', order: 1 }])).toEqual([
      { type: 'product', ref: 'zeytinyagi', order: 1 },
      { type: 'tier', ref: 'sezon', order: 2 },
    ]);
    expect(normalizeFeatured({ items: [{ type: 'product', ref: 'ekmek' }] })).toEqual([{ type: 'product', ref: 'ekmek', order: 1 }]);
    const f = normalizeSchema({ fields: [{ name: 'items', type: 'featured' }] });
    const st = toFormState(f, [{ type: 'product', ref: 'b', order: 2 }, { type: 'product', ref: 'a', order: 1 }]);
    expect(fromFormState(f, st)).toEqual([
      { type: 'product', ref: 'a', order: 1 },
      { type: 'product', ref: 'b', order: 2 },
    ]);
  });

  it('doğrulama: zorunlu / sayı / liste öğesi yolu / featured tekrar', () => {
    const errors = validateValues(fields, { title: '', count: 'abc', enabled: false, faq: [{ q: '', a: '' }] });
    expect(errors.title).toBeTruthy();
    expect(errors.count).toBeTruthy();
    expect(errors['faq.0.q']).toBeTruthy();
    expect(errors['faq.0.a']).toBeUndefined();
    const f = normalizeSchema({ fields: [{ name: 'items', type: 'featured' }] });
    const e2 = validateValues(f, { items: [{ type: 'product', ref: 'a', order: 1 }, { type: 'product', ref: 'a', order: 2 }, { type: 'tier', ref: '', order: 3 }] });
    expect(e2['items.1.ref']).toMatch(/iki kez/);
    expect(e2['items.2.ref']).toBeTruthy();
    expect(validateValues(fields, { title: 'ok', count: '', enabled: true, faq: [] })).toEqual({});
  });

  it('A registry min/max: sayı aralığı ve liste öğe sayısı', () => {
    const f = normalizeSchema({
      fields: [
        { name: 'order', type: 'number', min: 0, max: 999 },
        { name: 'items', type: 'list', min: 1, max: 2, itemFields: [{ name: 'q', type: 'text' }] },
      ],
    });
    expect(f[0].min).toBe(0);
    expect(f[1].max).toBe(2);
    expect(validateValues(f, { order: '1000', items: [{ q: 'a' }, { q: 'b' }, { q: 'c' }] })).toEqual({ order: 'En çok 999', items: 'En çok 2 öğe' });
    expect(validateValues(f, { order: '-1', items: [{ q: 'a' }] }).order).toBe('En az 0');
    expect(validateValues(f, { order: '5', items: [{ q: 'a' }] })).toEqual({});
  });

  it('toSiteMediaPath: baştaki eğik çizgiyi atar (site-göreli yol)', () => {
    expect(toSiteMediaPath('/uploads/sahne/x.webp')).toBe('uploads/sahne/x.webp');
    expect(toSiteMediaPath('/assets/images/y.jpg')).toBe('assets/images/y.jpg');
    expect(toSiteMediaPath('assets/images/y.jpg')).toBe('assets/images/y.jpg');
  });
});
