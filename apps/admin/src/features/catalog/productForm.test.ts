import { describe, expect, it } from 'vitest';
import type { AdminProductDetail } from '../../lib/adminTypes';
import {
  createDefaultProductDraft,
  detailToDraft,
  moneyToInput,
  parsePrefOptions,
  suggestSlug,
  tabsWithErrors,
  toProductBody,
  validateProductDraft,
  type ProductDraft,
} from './productForm';

function validDraft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    ...createDefaultProductDraft(),
    name: 'Erken Hasat Zeytinyağı',
    slug: 'erken-hasat-zeytinyagi',
    categoryId: 'cat_1',
    price: '489,90',
    unit: '500 ml',
    description: 'Soğuk sıkım, Urla.',
    ...overrides,
  };
}

describe('productForm — doğrulama', () => {
  it('geçerli taslakta hata yok', () => {
    expect(validateProductDraft(validDraft())).toEqual({});
  });

  it('zorunlu alanlar: ad, slug, kategori, fiyat, birim, açıklama', () => {
    const e = validateProductDraft(createDefaultProductDraft());
    expect(Object.keys(e).sort()).toEqual(['categoryId', 'description', 'name', 'price', 'slug', 'unit'].sort());
  });

  it('slug biçimi ve fiyat biçimi', () => {
    expect(validateProductDraft(validDraft({ slug: 'Büyük Harf' })).slug).toMatch(/küçük harf/);
    expect(validateProductDraft(validDraft({ slug: '-a' })).slug).toBeTruthy();
    expect(validateProductDraft(validDraft({ slug: 'a'.repeat(81) })).slug).toMatch(/80/);
    expect(validateProductDraft(validDraft({ slug: 'cig_sut-2' })).slug).toBeUndefined();
    expect(validateProductDraft(validDraft({ price: 'abc' })).price).toBeTruthy();
    expect(validateProductDraft(validDraft({ price: '-1' })).price).toMatch(/negatif/);
    expect(validateProductDraft(validDraft({ price: '1.250,75' })).price).toBeUndefined(); // tr-TR binlik nokta kabul
    expect(toProductBody(validDraft({ price: '1.250,75' })).price).toBe(1250.75);
  });

  it('tercih alanları tutarlı olmalı', () => {
    expect(validateProductDraft(validDraft({ prefLabel: 'Olgunluk', prefOptionsText: '' })).prefOptionsText).toBeTruthy();
    expect(validateProductDraft(validDraft({ prefLabel: '', prefOptionsText: 'A\nB' })).prefLabel).toBeTruthy();
    expect(validateProductDraft(validDraft({ prefLabel: 'Olgunluk', prefOptionsText: 'A\nB', prefDefault: '2' })).prefDefault).toMatch(/0–1/);
    expect(validateProductDraft(validDraft({ prefLabel: 'Olgunluk', prefOptionsText: 'A\nB', prefDefault: '1' })).prefDefault).toBeUndefined();
  });

  it('özel ekstra seçenekleri: çarpan pozitif, etiket zorunlu', () => {
    const e = validateProductDraft(
      validDraft({ useDefaultExtraOptions: false, extraOptions: [{ factor: '0', label: '' }, { factor: '0,5', label: '500 g' }] }),
    );
    expect(e['extraOptions.0.factor']).toBeTruthy();
    expect(e['extraOptions.0.label']).toBeTruthy();
    expect(e['extraOptions.1.factor']).toBeUndefined();
    expect(validateProductDraft(validDraft({ useDefaultExtraOptions: false, extraOptions: [] })).extraOptions).toBeTruthy();
  });

  it('hatalı sekmeler işaretlenir', () => {
    const e = validateProductDraft(validDraft({ price: '', prefLabel: 'X' }));
    const tabs = tabsWithErrors(e);
    expect(tabs.has('fiyat')).toBe(true);
    expect(tabs.has('tercih')).toBe(true);
    expect(tabs.has('genel')).toBe(false);
  });
});

describe('productForm — dönüşümler', () => {
  it('toProductBody sayıları ve null alanları doğru üretir', () => {
    const body = toProductBody(
      validDraft({
        price: '129,50',
        group: '  ',
        producerId: '',
        prefLabel: 'Olgunluk',
        prefOptionsText: 'Sert\n\nYumuşak\n',
        prefDefault: '1',
        useDefaultExtraOptions: false,
        extraOptions: [{ factor: '0,25', label: '250 g' }],
        pairWithBox: true,
        pairOrder: '3',
        sortOrder: '12',
      }),
    );
    expect(body.price).toBe(129.5);
    expect(body.group).toBeNull();
    expect(body.producerId).toBeNull();
    expect(body.prefOptions).toEqual(['Sert', 'Yumuşak']);
    expect(body.prefDefault).toBe(1);
    expect(body.extraOptions).toEqual([{ factor: 0.25, label: '250 g' }]);
    expect(body.pairWithBox).toBe(true);
    expect(body.pairOrder).toBe(3);
    expect(body.sortOrder).toBe(12);
    expect(body.status).toBe('DRAFT');
  });

  it('varsayılan ekstra seçenekleri → extraOptions null', () => {
    expect(toProductBody(validDraft()).extraOptions).toBeNull();
    expect(toProductBody(validDraft({ prefOptionsText: '' })).prefDefault).toBeNull();
  });

  it('detailToDraft ↔ toProductBody gidiş-dönüş', () => {
    const detail: AdminProductDetail = {
      id: 'p1',
      slug: 'domates',
      name: 'Domates',
      categoryId: 'c1',
      category: { id: 'c1', slug: 'boxes', label: 'Kutu' },
      group: 'sebze',
      producerId: 'pr1',
      producer: { id: 'pr1', name: 'Ali' },
      metaNote: null,
      price: 45,
      vatRate: 1,
      unit: 'kg',
      boxAmount: '1 kg',
      extraOptions: [{ factor: 0.5, label: '500 g' }],
      description: 'Tarla domatesi',
      storageText: null,
      allergenText: null,
      freshnessNote: 'Hasattan 24 saat içinde',
      prefLabel: null,
      prefOptions: [],
      prefDefault: null,
      isFresh: true,
      season: 'yaz',
      status: 'ACTIVE',
      stockStatus: 'LOW',
      pairWithBox: false,
      pairOrder: 0,
      sortOrder: 5,
      images: [],
      lots: [],
      currentLot: null,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      deletedAt: null,
    };
    const draft = detailToDraft(detail);
    expect(draft.price).toBe('45,00');
    expect(draft.useDefaultExtraOptions).toBe(false);
    expect(draft.extraOptions).toEqual([{ factor: '0,5', label: '500 g' }]);
    expect(validateProductDraft(draft)).toEqual({});
    const body = toProductBody(draft);
    expect(body).toMatchObject({
      slug: 'domates',
      name: 'Domates',
      categoryId: 'c1',
      group: 'sebze',
      producerId: 'pr1',
      price: 45,
      vatRate: 1,
      unit: 'kg',
      boxAmount: '1 kg',
      extraOptions: [{ factor: 0.5, label: '500 g' }],
      isFresh: true,
      season: 'yaz',
      status: 'ACTIVE',
      stockStatus: 'LOW',
      sortOrder: 5,
    });
  });

  it('yardımcılar: moneyToInput, parsePrefOptions, suggestSlug', () => {
    expect(moneyToInput(12)).toBe('12,00');
    expect(moneyToInput('7.5')).toBe('7,50');
    expect(moneyToInput(null)).toBe('');
    expect(parsePrefOptions(' a \n\n b ')).toEqual(['a', 'b']);
    expect(suggestSlug('Çiğ Süt — Günlük (1 lt)')).toBe('cig-sut-gunluk-1-lt');
  });
});
