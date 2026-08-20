import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TextInput } from '../../../components/ui/FormField';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { errorMessage } from '../../../lib/api';
import type { AdminMediaFile, AdminProductImage } from '../../../lib/adminTypes';
import { btn } from '../../../lib/buttonStyles';
import { toast } from '../../../lib/toast';
import { cn, mergeFromServer, moveItem } from '../../../lib/utils';
import { ReorderButtons } from '../../components/ReorderButtons';
import { InlineNotice } from '../../components/StateBlocks';
import { MediaPickerModal } from '../../medya/MediaPickerModal';
import { MediaThumb } from '../../medya/MediaThumb';
import { productsApi } from '../api';

type Props = {
  productId: string | null;
  images: AdminProductImage[];
  onChange: (images: AdminProductImage[]) => void;
  productName: string;
};

/** Görseller sekmesi: medya picker'dan ekle, kapak, sıra (sürükle / ok), alt metin, kaldır (MediaFile silinmez). */
export function TabGorseller({ productId, images, onChange, productName }: Props) {
  const confirm = useConfirm();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});

  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);

  if (!productId) {
    return <InlineNotice tone="info">Görseller, ürün ilk kez kaydedildikten sonra eklenir. Önce <strong>Kaydet</strong>'e basın.</InlineNotice>;
  }

  async function addFromMedia(file: AdminMediaFile) {
    if (images.some((i) => i.mediaId === file.id)) {
      toast.info('Bu görsel zaten ekli');
      return;
    }
    try {
      const created = await productsApi.addImage(productId!, { mediaId: file.id, alt: file.alt ?? null, isCover: images.length === 0 });
      const img = mergeFromServer<AdminProductImage>(
        {
          id: `tmp-${Date.now()}`,
          mediaId: file.id,
          url: file.url,
          thumbUrl: file.thumbUrl,
          alt: file.alt ?? null,
          isCover: images.length === 0,
          sortOrder: images.length,
        },
        created,
      );
      onChange([...(img.isCover ? images.map((i) => ({ ...i, isCover: false })) : images), img]);
      toast.success('Görsel eklendi');
    } catch (e) {
      toast.error(errorMessage(e, 'Görsel eklenemedi'));
    }
  }

  async function setCover(img: AdminProductImage) {
    if (img.isCover) return;
    setBusyId(img.id);
    try {
      await productsApi.updateImage(productId!, img.id, { isCover: true });
      onChange(images.map((i) => ({ ...i, isCover: i.id === img.id })));
      toast.success('Kapak görseli güncellendi');
    } catch (e) {
      toast.error(errorMessage(e, 'Güncellenemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function saveAlt(img: AdminProductImage) {
    const next = altDrafts[img.id];
    if (next === undefined || next === (img.alt ?? '')) return;
    setBusyId(img.id);
    try {
      await productsApi.updateImage(productId!, img.id, { alt: next.trim() || null });
      onChange(images.map((i) => (i.id === img.id ? { ...i, alt: next.trim() || null } : i)));
      setAltDrafts((d) => {
        const { [img.id]: _omit, ...rest } = d;
        return rest;
      });
      toast.success('Alt metin kaydedildi');
    } catch (e) {
      toast.error(errorMessage(e, 'Kaydedilemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(img: AdminProductImage) {
    const ok = await confirm({
      title: 'Görseli kaldır',
      description: 'Görsel üründen kaldırılır; medya kütüphanesindeki dosya silinmez.',
      confirmLabel: 'Kaldır',
      danger: true,
    });
    if (!ok) return;
    setBusyId(img.id);
    try {
      await productsApi.removeImage(productId!, img.id);
      const rest = images.filter((i) => i.id !== img.id);
      if (img.isCover && rest.length) rest[0] = { ...rest[0], isCover: true };
      onChange(rest);
      toast.success('Görsel kaldırıldı');
    } catch (e) {
      toast.error(errorMessage(e, 'Kaldırılamadı'));
    } finally {
      setBusyId(null);
    }
  }

  async function persistOrder(next: AdminProductImage[]) {
    const prev = images;
    const renumbered = next.map((i, idx) => ({ ...i, sortOrder: idx }));
    onChange(renumbered);
    try {
      await productsApi.reorderImages(productId!, renumbered.map((i) => i.id));
    } catch (e) {
      onChange(prev);
      toast.error(errorMessage(e, 'Sıra kaydedilemedi'));
    }
  }

  function onMove(from: number, to: number) {
    void persistOrder(moveItem(sorted, from, to));
  }

  function onDropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = sorted.findIndex((i) => i.id === dragId);
    const to = sorted.findIndex((i) => i.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    void persistOrder(moveItem(sorted, from, to));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-brand-500">
          İlk görsel (kapak) ürün kartında; diğerleri ürün sayfası galerisinde. Sıra için sürükleyin ya da okları kullanın.
        </p>
        <button type="button" onClick={() => setPickerOpen(true)} className={btn.primary}>
          <ImagePlus className="h-4 w-4" aria-hidden /> Medyadan ekle
        </button>
      </div>

      {sorted.length === 0 ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand-300 bg-brand-50/60 px-4 py-10 text-sm text-brand-600 hover:border-accent hover:bg-accent-light"
        >
          <ImagePlus className="h-6 w-6 text-brand-400" aria-hidden />
          Henüz görsel yok — medya kütüphanesinden seçin ya da yükleyin
        </button>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((img, idx) => {
            const busy = busyId === img.id;
            const altValue = altDrafts[img.id] ?? img.alt ?? '';
            return (
              <li
                key={img.id}
                draggable
                onDragStart={() => setDragId(img.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropOn(img.id)}
                onDragEnd={() => setDragId(null)}
                className={cn('flex gap-3 rounded-lg border bg-white p-2', img.isCover ? 'border-olive/50' : 'border-brand-200', dragId === img.id && 'opacity-50')}
              >
                <div className="relative shrink-0">
                  <MediaThumb src={img.thumbUrl ?? img.url} alt={img.alt ?? productName} className="h-24 w-24" />
                  {img.isCover && (
                    <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-olive px-1 text-[10px] font-semibold text-white">
                      <Star className="h-2.5 w-2.5" aria-hidden /> Kapak
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <ReorderButtons index={idx} count={sorted.length} onMove={onMove} disabled={busy} />
                    <div className="flex items-center gap-1">
                      {!img.isCover && (
                        <button type="button" disabled={busy} onClick={() => void setCover(img)} className={cn(btn.secondary, 'h-7 px-2 text-[11px]')} title="Kapak yap">
                          <Star className="h-3 w-3" aria-hidden /> Kapak
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => void remove(img)} className={cn(btn.iconDanger, 'h-7 w-7')} aria-label="Görseli kaldır" title="Kaldır">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <TextInput
                    value={altValue}
                    maxLength={160}
                    placeholder="Alt metin"
                    aria-label="Alt metin"
                    onChange={(e) => setAltDrafts((d) => ({ ...d, [img.id]: e.target.value }))}
                    onBlur={() => void saveAlt(img)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void saveAlt(img);
                      }
                    }}
                    className="py-1 text-xs"
                  />
                  <p className="truncate font-mono text-[10px] text-brand-400" title={img.url}>{img.url}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <MediaPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(f) => void addFromMedia(f)} title={`Ürün görseli seç — ${productName || 'ürün'}`} defaultFolder="urunler" />
    </div>
  );
}
