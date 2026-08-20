// database/seeds/lib/slug.ts — Türkçe karakter duyarlı, deterministik slug üretimi
// "Hüseyin Dağ" → "huseyin-dag", "İbrahim Sarı" → "ibrahim-sari", "Şerife Kaya" → "serife-kaya".

const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c',
  ğ: 'g', Ğ: 'g',
  ı: 'i', I: 'i', İ: 'i',
  ö: 'o', Ö: 'o',
  ş: 's', Ş: 's',
  ü: 'u', Ü: 'u',
  â: 'a', Â: 'a',
  î: 'i', Î: 'i',
  û: 'u', Û: 'u',
};

/** Metni URL-güvenli slug'a çevirir (yalnız a-z0-9 ve '-'). Boş sonuç → hata (sessiz veri kaybı olmasın). */
export function slugify(input: string): string {
  const mapped = Array.from(input.trim())
    .map((ch) => TR_MAP[ch] ?? ch)
    .join('')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // kalan aksanlar
  const slug = mapped.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`slugify: boş slug üretildi ("${input}")`);
  return slug;
}
