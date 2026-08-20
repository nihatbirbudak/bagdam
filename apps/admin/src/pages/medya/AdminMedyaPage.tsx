import { Copy, ExternalLink, ImageIcon, Pencil, Save, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Field, FormErrorBanner, Select, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminToolbar } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { MEDIA_ALT_MAX, MEDIA_FOLDER_RE, MEDIA_FOLDERS, mediaApi } from '../../features/medya/api';
import { MediaDropzone } from '../../features/medya/MediaDropzone';
import { MediaThumb } from '../../features/medya/MediaThumb';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { ApiError, errorMessage, extractFieldErrors, resolveMediaUrl } from '../../lib/api';
import type { AdminMediaFile } from '../../lib/adminTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cn, formatBytes, formatDateTime, mergeFromServer } from '../../lib/utils';

const LIMIT_DEFAULT = 48;

/** Ekran 8 — Medya: klasör / arama / sayfalama, yükleme (drag-drop + dosya), alt/klasör düzenle, sil (409 mesajı). */
export function AdminMedyaPage() {
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const folder = params.get('folder') ?? '';
  const q = params.get('q') ?? '';

  const setParam = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'limit' && v === LIMIT_DEFAULT)) next.delete(k);
        else next.set(k, String(v));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const list = usePaginatedList<AdminMediaFile>('/admin/media', { page, limit, folder: folder || undefined, q: q || undefined });
  const serverFolders = useMemo(() => (Array.isArray(list.extra.folders) ? (list.extra.folders as string[]) : []), [list.extra]);
  const folders = useMemo(() => Array.from(new Set([...serverFolders, ...MEDIA_FOLDERS])).sort(), [serverFolders]);
  const [uploadFolder, setUploadFolder] = useState<string>('urunler');

  const [editing, setEditing] = useState<AdminMediaFile | null>(null);
  const [draft, setDraft] = useState<{ alt: string; folder: string }>({ alt: '', folder: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openEdit(file: AdminMediaFile) {
    setEditing(file);
    setDraft({ alt: file.alt ?? '', folder: file.folder });
    setErrors({});
    setFormError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const v: Record<string, string> = {};
    if (draft.alt.length > MEDIA_ALT_MAX) v.alt = `En fazla ${MEDIA_ALT_MAX} karakter`;
    if (!draft.folder.trim()) v.folder = 'Klasör zorunlu';
    else if (!MEDIA_FOLDER_RE.test(draft.folder.trim())) v.folder = 'Küçük harf, rakam, tire (1–40)';
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true);
    setFormError(null);
    try {
      const updated = await mediaApi.update(editing.id, { alt: draft.alt.trim() || null, folder: draft.folder.trim() });
      list.setItems((prev) => prev.map((f) => (f.id === editing.id ? mergeFromServer<AdminMediaFile>({ ...f, alt: draft.alt.trim() || null, folder: draft.folder.trim() }, updated) : f)));
      toast.success('Medya güncellendi');
      setEditing(null);
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(file: AdminMediaFile) {
    const ok = await confirm({
      title: 'Medyayı sil',
      description: `"${file.originalName}" kalıcı olarak silinecek (dosya + kayıt). Bir ürün/kutu/üretici bu görseli kullanıyorsa sunucu silmeyi reddeder.`,
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await mediaApi.remove(file.id);
      toast.success('Medya silindi');
      void list.reload();
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'conflict') toast.warning(e.message || 'Bu görsel kullanımda; önce bağlantılarını kaldırın.');
      else toast.error(errorMessage(e, 'Silinemedi'));
    }
  }

  async function copyUrl(file: AdminMediaFile) {
    const url = `${window.location.origin}${resolveMediaUrl(file.url)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.info('Bağlantı kopyalandı');
    } catch {
      toast.error('Kopyalanamadı');
    }
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Medya"
        description="Görsel kütüphanesi: import edilen mevcut görseller (assets/images, logo, icons) + yeni yüklemeler (/uploads, webp). Ürün ve kutu görselleri buradan seçilir."
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_18rem]">
        <MediaDropzone folder={uploadFolder} onUploaded={() => void list.reload()} />
        <div className="rounded-lg border border-brand-200 bg-white p-3">
          <label htmlFor="upload-folder" className="mb-1 block text-xs font-medium text-brand-600">Yükleme klasörü</label>
          <Select id="upload-folder" value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)}>
            {folders.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </Select>
          <p className="mt-2 text-[11px] leading-snug text-brand-500">
            Yeni yüklemeler <code>apps/api/uploads/&lt;klasör&gt;/</code> altına webp olarak yazılır (max 2000 px + 400 px küçük resim).
          </p>
        </div>
      </div>

      <AdminToolbar
        searchPlaceholder="Dosya adı / alt metin ara…"
        searchValue={q}
        onSearchChange={(v) => setParam({ q: v, page: 1 })}
        filters={
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Klasör">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-brand-400">Klasör</span>
            <button
              type="button"
              onClick={() => setParam({ folder: '', page: 1 })}
              aria-pressed={folder === ''}
              className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', folder === '' ? 'border-accent bg-accent/10 text-accent' : 'border-brand-300 text-brand-600 hover:bg-brand-50')}
            >
              Tümü
            </button>
            {folders.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setParam({ folder: f, page: 1 })}
                aria-pressed={folder === f}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', folder === f ? 'border-accent bg-accent/10 text-accent' : 'border-brand-300 text-brand-600 hover:bg-brand-50')}
              >
                {f}
              </button>
            ))}
          </div>
        }
        className="mb-3"
      />

      <div className="rounded-lg border border-brand-200 bg-white">
        {list.loading && list.items.length === 0 ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock message={list.error} onRetry={() => void list.reload()} className="m-3" />
        ) : list.items.length === 0 ? (
          <AdminEmptyState icon={ImageIcon} message={q || folder ? 'Filtreye uyan dosya yok.' : 'Henüz medya yok. Yukarıdan yükleyin ya da `pnpm --filter @bagdam/api media:import` çalıştırın.'} />
        ) : (
          <ul className={cn('grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6', list.loading && 'opacity-60')}>
            {list.items.map((file) => (
              <li key={file.id} className="group flex flex-col rounded-lg border border-brand-200 bg-white p-2">
                <a href={resolveMediaUrl(file.url)} target="_blank" rel="noopener noreferrer" className="block" title="Yeni sekmede aç">
                  <MediaThumb src={file.thumbUrl ?? file.url} alt={file.alt} className="aspect-square w-full" contain />
                </a>
                <div className="mt-1.5 min-w-0">
                  <p className="truncate text-xs font-medium text-brand-900" title={file.originalName}>{file.originalName}</p>
                  <p className="truncate text-[10px] text-brand-500">
                    {file.folder} · {file.width && file.height ? `${file.width}×${file.height} · ` : ''}{formatBytes(file.size)}
                  </p>
                  <p className="truncate text-[10px] text-brand-400" title={file.alt ?? ''}>{file.alt ? `alt: ${file.alt}` : 'alt yok'}</p>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <button type="button" onClick={() => openEdit(file)} className={cn(btn.icon, 'h-7 w-7')} aria-label="Düzenle" title="Alt metin / klasör">
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => void copyUrl(file)} className={cn(btn.icon, 'h-7 w-7')} aria-label="Bağlantıyı kopyala" title="Bağlantıyı kopyala">
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <a href={resolveMediaUrl(file.url)} target="_blank" rel="noopener noreferrer" className={cn(btn.icon, 'h-7 w-7')} aria-label="Aç" title="Yeni sekmede aç">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  <button type="button" onClick={() => void handleDelete(file)} className={cn(btn.iconDanger, 'ml-auto h-7 w-7')} aria-label="Sil" title="Sil">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pagination
          total={list.total}
          page={page}
          limit={limit}
          onPageChange={(p) => setParam({ page: p })}
          onLimitChange={(l) => setParam({ limit: l, page: 1 })}
          limitOptions={[24, 48, 96]}
        />
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Medya — ${editing.originalName}` : ''}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className={btn.secondary}>İptal</button>
            <button type="submit" form="media-form" disabled={saving} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        {editing && (
          <form id="media-form" onSubmit={handleSave} className="space-y-4" noValidate>
            <FormErrorBanner message={formError} />
            <div className="flex gap-4">
              <MediaThumb src={editing.thumbUrl ?? editing.url} alt={editing.alt} className="h-28 w-28 shrink-0" contain />
              <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-brand-500">Yol</dt>
                <dd className="truncate font-mono" title={editing.url}>{editing.url}</dd>
                <dt className="text-brand-500">Tür</dt>
                <dd>{editing.mimeType}</dd>
                <dt className="text-brand-500">Boyut</dt>
                <dd>{editing.width && editing.height ? `${editing.width}×${editing.height} · ` : ''}{formatBytes(editing.size)}</dd>
                <dt className="text-brand-500">Yüklenme</dt>
                <dd>{formatDateTime(editing.createdAt)}</dd>
              </dl>
            </div>
            <Field label="Alt metin" hint="Erişilebilirlik ve SEO; ürün görselinde ayrıca ürün bazında alt verilebilir." error={errors.alt}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.alt} maxLength={MEDIA_ALT_MAX} onChange={(e) => setDraft({ ...draft, alt: e.target.value })} />}
            </Field>
            <Field label="Klasör" error={errors.folder}>
              {({ id, invalid }) => (
                <>
                  <TextInput id={id} invalid={invalid} list="media-folder-list" value={draft.folder} onChange={(e) => setDraft({ ...draft, folder: e.target.value })} className="font-mono" />
                  <datalist id="media-folder-list">
                    {folders.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}
