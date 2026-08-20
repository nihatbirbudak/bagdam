import { describe, expect, it } from 'vitest';
import type { AdminPost } from '../../lib/apiTypes';
import { emptyPostDraft, parseRelatedSlugs, postToDraft, stripHtml, suggestPostSlug, toPostBody, validatePostDraft } from './postForm';

const POST: AdminPost = {
  id: 'p1',
  slug: 'cavdar-ekmegi',
  kind: 'söyleşi',
  readMinutes: 5,
  titleHtml: 'bir annenin ekmeği, <em>iki sofrada</em>',
  excerpt: null,
  bodyHtml: '<p>Gövde</p>',
  coverMediaId: null,
  coverUrl: null,
  relatedSlugs: ['zeytinyagi', 'incir'],
  status: 'PUBLISHED',
  publishedAt: '2026-08-16T09:00:00.000Z',
  createdAt: '2026-08-16T09:00:00.000Z',
  updatedAt: '2026-08-16T09:00:00.000Z',
};

describe('postForm', () => {
  it('stripHtml / suggestPostSlug: başlık HTML → düz metin → slug', () => {
    expect(stripHtml(POST.titleHtml)).toBe('bir annenin ekmeği, iki sofrada');
    expect(suggestPostSlug(POST.titleHtml)).toBe('bir-annenin-ekmegi-iki-sofrada');
    expect(stripHtml('a &amp; b &nbsp; c')).toBe('a & b c');
  });

  it('parseRelatedSlugs: virgül/satır/noktalı virgül, boşlar atılır, tekil', () => {
    expect(parseRelatedSlugs('a, b;c\n a ,,')).toEqual(['a', 'b', 'c']);
    expect(parseRelatedSlugs('')).toEqual([]);
  });

  it('postToDraft → toPostBody gidiş-dönüş', () => {
    const d = postToDraft(POST);
    expect(d.readMinutes).toBe('5');
    expect(d.relatedSlugsText).toBe('zeytinyagi, incir');
    expect(d.status).toBe('PUBLISHED');
    expect(toPostBody(d)).toEqual({
      slug: 'cavdar-ekmegi',
      kind: 'söyleşi',
      readMinutes: 5,
      titleHtml: POST.titleHtml,
      excerpt: null,
      bodyHtml: '<p>Gövde</p>',
      coverMediaId: null,
      relatedSlugs: ['zeytinyagi', 'incir'],
      status: 'PUBLISHED',
    });
  });

  it('doğrulama: boş taslak hataları; geçerli taslak temiz; kendine referans', () => {
    const empty = validatePostDraft(emptyPostDraft());
    expect(empty.slug).toBeTruthy();
    expect(empty.titleHtml).toBeTruthy();
    expect(empty.bodyHtml).toBeTruthy();
    expect(empty.kind).toBeUndefined();
    const ok = postToDraft(POST);
    expect(validatePostDraft(ok)).toEqual({});
    expect(validatePostDraft({ ...ok, slug: 'Büyük Harf' }).slug).toBeTruthy();
    expect(validatePostDraft({ ...ok, readMinutes: '0' }).readMinutes).toBeTruthy();
    expect(validatePostDraft({ ...ok, relatedSlugsText: 'cavdar-ekmegi' }).relatedSlugsText).toMatch(/kendisini/);
    expect(validatePostDraft({ ...ok, titleHtml: '<em></em>' }).titleHtml).toBeTruthy();
  });
});
