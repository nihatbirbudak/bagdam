// database/seeds/lib/meta.ts — products.js `meta` alanının ayrıştırılması
// Biçim: "Üretici · Köy · İlçe[ — not]"  (ör. "Bağdam Çiftlik · Kuşçular · Urla — Erken Hasat")
// Ayraçlar: " · " (orta nokta U+00B7) ve " — " (em dash U+2014). Beklenmeyen biçim → hata (sessiz bozulma olmasın).

export interface ParsedMeta {
  producerName: string;
  village: string | null;
  district: string;
  metaNote: string | null;
}

const PART_SEP = ' · ';
const NOTE_SEP = ' — ';

export function parseMeta(meta: string, productId: string): ParsedMeta {
  const parts = meta.split(PART_SEP).map((s) => s.trim());
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`meta ayrıştırılamadı (${productId}): "${meta}" — "Üretici · Köy · İlçe[ — not]" bekleniyor`);
  }
  const producerName = parts[0] ?? '';
  if (!producerName) throw new Error(`meta üretici adı boş (${productId}): "${meta}"`);

  // Son parça "İlçe[ — not]"; iki parçalıysa köy yok: "Üretici · İlçe"
  const last = parts[parts.length - 1] ?? '';
  const noteIdx = last.indexOf(NOTE_SEP);
  const district = (noteIdx === -1 ? last : last.slice(0, noteIdx)).trim();
  const metaNote = noteIdx === -1 ? null : last.slice(noteIdx + NOTE_SEP.length).trim() || null;
  if (!district) throw new Error(`meta ilçe boş (${productId}): "${meta}"`);

  const village = parts.length === 3 ? (parts[1] ?? '').trim() || null : null;
  return { producerName, village, district, metaNote };
}
