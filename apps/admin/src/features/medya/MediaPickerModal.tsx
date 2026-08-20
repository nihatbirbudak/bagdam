import { Check, Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AdminMediaFile, AdminMediaList } from '../../lib/adminTypes';
import { errorMessage } from '../../lib/api';
import { btn } from '../../lib/buttonStyles';
import { cn, formatBytes } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../components/Pagination';
import { MEDIA_FOLDERS, isImageMime, mediaApi } from './api';
import { MediaDropzone } from './MediaDropzone';
import { MediaThumb } from './MediaThumb';

export interface MediaPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (file: AdminMediaFile) => void;
  title?: string;
  /** Yüklemelerin gideceği varsayılan klasör. */
  defaultFolder?: string;
  /** Yalnız görseller (varsayılan true). */
  imagesOnly?: boolean;
}

const PAGE_SIZE = 24;

/** Medya seçici: klasör + arama + sayfalama + hızlı yükleme; tek dosya seçer. */
export function MediaPickerModal({ open, onClose, onSelect, title = 'Görsel seç', defaultFolder = 'urunler', imagesOnly = true }: MediaPickerModalProps) {
  const [folder, setFolder] = useState<string>('');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminMediaList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminMediaFile | null>(null);
  const [uploadFolder, setUploadFolder] = useState(defaultFolder);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mediaApi.list({ page, limit: PAGE_SIZE, folder: folder || undefined, q: q || undefined });
      setData(res);
    } catch (e) {
      setError(errorMessage(e, 'Medya listesi yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [page, folder, q]);

  // Açılışta sıfırla
  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setPage(1);
    setQ('');
    setQInput('');
    setFolder('');
    setUploadFolder(defaultFolder);
  }, [open, defaultFolder]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Arama debounce
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (qInput !== q) {
        setQ(qInput);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, q, open]);

  const folders = Array.from(new Set([...(data?.folders ?? []), ...MEDIA_FOLDERS])).sort();
  const items = (data?.items ?? []).filter((f) => !imagesOnly || isImageMime(f.mimeType));

  function confirm() {
    if (!selected) return;
    onSelect(selected);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="2xl"
      footer={
        <>
          <span className="mr-auto truncate text-xs text-brand-500">
            {selected ? `${selected.originalName} · ${selected.width ?? '?'}×${selected.height ?? '?'} · ${formatBytes(selected.size)}` : 'Bir görsel seçin'}
          </span>
          <button type="button" onClick={onClose} className={btn.secondary}>İptal</button>
          <button type="button" onClick={confirm} disabled={!selected} className={btn.primary}>Seç</button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[11rem_1fr]">
        {/* Klasörler */}
        <aside className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-400">Klasörler</p>
          <button
            type="button"
            onClick={() => { setFolder(''); setPage(1); }}
            className={cn('block w-full rounded px-2 py-1 text-left text-sm', folder === '' ? 'bg-accent/10 font-semibold text-accent' : 'text-brand-700 hover:bg-brand-50')}
          >
            Tümü
          </button>
          {folders.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => { setFolder(f); setPage(1); }}
              className={cn('block w-full truncate rounded px-2 py-1 text-left text-sm', folder === f ? 'bg-accent/10 font-semibold text-accent' : 'text-brand-700 hover:bg-brand-50')}
            >
              {f}
            </button>
          ))}
          <div className="pt-3">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-brand-400">Yükleme klasörü</label>
            <select
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              className="mb-2 w-full rounded-md border border-brand-300 bg-white px-2 py-1 text-xs"
            >
              {folders.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <MediaDropzone
              folder={uploadFolder}
              compact
              onUploaded={(files) => {
                setFolder(uploadFolder);
                setPage(1);
                setSelected(files[0] ?? null);
                void load();
              }}
            />
          </div>
        </aside>

        {/* Liste */}
        <div className="min-w-0">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-400" aria-hidden />
            <input
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Dosya adı / alt metin ara…"
              aria-label="Medya ara"
              className="w-full rounded-md border border-brand-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-brand-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Yükleniyor…</div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-accent-dark">
              {error}
              <button type="button" onClick={() => void load()} className={cn(btn.secondary, btn.sm)}>Yeniden dene</button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-brand-500">Görsel bulunamadı.</div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6" role="listbox" aria-label="Görseller">
              {items.map((file) => {
                const chosen = selected?.id === file.id;
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={chosen}
                      onClick={() => setSelected(file)}
                      onDoubleClick={() => { setSelected(file); onSelect(file); onClose(); }}
                      title={file.originalName}
                      className={cn(
                        'relative flex w-full flex-col rounded-lg border p-1.5 text-left transition-colors',
                        chosen ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-brand-200 hover:border-accent/50',
                      )}
                    >
                      {chosen && (
                        <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-accent p-0.5 text-white"><Check className="h-3 w-3" aria-hidden /></span>
                      )}
                      <MediaThumb src={file.thumbUrl ?? file.url} alt={file.alt} className="aspect-square w-full" contain />
                      <span className="mt-1 block truncate text-[10px] text-brand-600">{file.originalName}</span>
                      <span className="block truncate text-[10px] text-brand-400">{file.folder}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {data && data.total > PAGE_SIZE && (
            <Pagination total={data.total} page={page} limit={PAGE_SIZE} onPageChange={setPage} className="mt-3 rounded-md border border-brand-200" />
          )}
        </div>
      </div>
    </Modal>
  );
}
