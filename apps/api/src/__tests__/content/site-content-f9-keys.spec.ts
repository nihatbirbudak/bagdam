// F9/C — `uyelik.texts` ve `sepet.texts` SiteContent blokları: registry ↔ seed ↔ şablon (uyelik.hbs / sepet.hbs)
// tutarlılığı. DB gerekmez: registry (kaynak) + seed JSON + .hbs dosyaları okunur.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SITE_CONTENT_PAGES, SITE_CONTENT_REGISTRY } from '../../modules/content/site-content.registry';
import { buildSiteTree } from '../../web/content-view';
import { API_ROOT, REPO_ROOT } from '../helpers/env';

const SEED_FILE = resolve(REPO_ROOT, 'database', 'seeds', 'content', 'site-content.json');
const UYELIK_HBS = resolve(API_ROOT, 'views', 'uyelik.hbs');
const SEPET_HBS = resolve(API_ROOT, 'views', 'sepet.hbs');

interface SeedDoc {
  values: Record<string, Record<string, unknown>>;
}

const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedDoc;
const entry = (key: string) => SITE_CONTENT_REGISTRY.find((e) => e.key === key);
const fieldNames = (key: string): string[] => (entry(key)?.schema.fields ?? []).map((f) => f.name);

describe('SiteContent F9 blokları — uyelik.texts / sepet.texts', () => {
  it('registry: iki blok da kayıtlı ve sayfa grupları tanımlı', () => {
    expect(entry('uyelik.texts')).toBeDefined();
    expect(entry('sepet.texts')).toBeDefined();
    expect(entry('uyelik.texts')!.page).toBe('uyelik');
    expect(entry('sepet.texts')!.page).toBe('sepet');
    expect(SITE_CONTENT_PAGES).toEqual(expect.arrayContaining(['uyelik', 'sepet']));
  });

  it('seed: her registry alanı için değer var, boş değer yok', () => {
    for (const key of ['uyelik.texts', 'sepet.texts']) {
      const values = seed.values[key];
      expect(values).toBeDefined();
      expect(Object.keys(values!).sort()).toEqual(fieldNames(key).sort());
      for (const [name, value] of Object.entries(values!)) {
        expect(typeof value).toBe('string');
        expect((value as string).trim().length).toBeGreaterThan(0);
        expect(name).toMatch(/^[a-z][A-Za-z0-9]*$/); // dataset uyumu: camelCase
      }
    }
  });

  it('uyelik.hbs: <template id="uyelikTexts"> data-* anahtarları registry ile birebir', () => {
    const hbs = readFileSync(UYELIK_HBS, 'utf8');
    const wired = [...hbs.matchAll(/site\.uyelik\.texts\.(\w+)/g)].map((m) => m[1]!);
    expect(wired.length).toBeGreaterThan(0);
    expect([...new Set(wired)].sort()).toEqual(fieldNames('uyelik.texts').sort());
  });

  it('sepet.hbs: <template id="sepetTexts"> data-* anahtarları registry ile birebir', () => {
    const hbs = readFileSync(SEPET_HBS, 'utf8');
    const wired = [...hbs.matchAll(/site\.sepet\.texts\.(\w+)/g)].map((m) => m[1]!);
    expect(wired.length).toBeGreaterThan(0);
    expect([...new Set(wired)].sort()).toEqual(fieldNames('sepet.texts').sort());
  });

  it('sayfa betikleri: her anahtar için varsayılan metin var (CMS boşsa markup korunur)', () => {
    const cases: Array<[string, string, string]> = [
      ['uyelik.texts', UYELIK_HBS, 'SUB_TEXT_DEFAULTS'],
      ['sepet.texts', SEPET_HBS, 'SEPET_TEXT_DEFAULTS'],
    ];
    for (const [key, file, marker] of cases) {
      const hbs = readFileSync(file, 'utf8');
      const start = hbs.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      const block = hbs.slice(start, start + 12_000);
      for (const name of fieldNames(key)) {
        expect(block).toContain(`${name}:`);
      }
    }
  });

  it('metin tipi: hepsi text/textarea — değerler HTML-kaçışlı basılır (data-* özniteliği bozulmaz)', () => {
    for (const key of ['uyelik.texts', 'sepet.texts']) {
      for (const field of entry(key)!.schema.fields) {
        expect(['text', 'textarea']).toContain(field.type);
      }
    }
  });

  it('şablon ağacı: site.uyelik.texts.* / site.sepet.texts.* dolu ve HTML-kaçışlı (data-* özniteliği bozulmaz)', () => {
    const rows = ['uyelik.texts', 'sepet.texts'].map((key) => ({ key, schema: entry(key)!.schema, value: seed.values[key]! }));
    const tree = buildSiteTree(rows) as { uyelik: { texts: Record<string, string> }; sepet: { texts: Record<string, string> } };
    expect(tree.uyelik.texts.empty).toBe(seed.values['uyelik.texts']!.empty);
    expect(tree.sepet.texts.summaryTitle).toBe(seed.values['sepet.texts']!.summaryTitle);
    // richtext DEĞİL → HTML kaçışlanır: <b> ham kalmaz, tırnak/işaret öznitelik içinde güvenli
    expect(tree.uyelik.texts.retentionOffer).toContain('&lt;b&gt;');
    expect(tree.uyelik.texts.retentionOffer).not.toContain('<b>');
    for (const texts of [tree.uyelik.texts, tree.sepet.texts]) {
      for (const value of Object.values(texts)) {
        expect(value).not.toMatch(/(?<!&quot;)"/); // ham çift tırnak kalmamalı
      }
    }
  });

  it('yer tutucular: retentionOffer {boxes}/{pct}, sepet başarı metinleri {no}', () => {
    const uyelik = seed.values['uyelik.texts']! as Record<string, string>;
    expect(uyelik.retentionOffer).toContain('{boxes}');
    expect(uyelik.retentionOffer).toContain('{pct}');
    const sepet = seed.values['sepet.texts']! as Record<string, string>;
    expect(sepet.successOrder).toContain('{no}');
    expect(sepet.successSubscription).toContain('{no}');
    expect(sepet.legalSingleRequiredError).toContain('{belge}');
    // Mesafeli satış ibaresi CMS'ten silinmemeli (ADR-0003 istisna 3)
    expect(sepet.completeCta).toContain('ödeme yükümlülüğü doğurur');
  });
});
