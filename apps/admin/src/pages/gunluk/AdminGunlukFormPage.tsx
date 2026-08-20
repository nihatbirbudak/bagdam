import { ArrowLeft, ExternalLink, ImagePlus, Save, SaveAll, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Field, FormErrorBanner, FormSection, Select, TextArea, TextInput } from '../../components/ui/FormField';
import { RichTextLite } from '../../components/ui/RichTextLite';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { ContentStatusBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { postsApi } from '../../features/icerik/api';
import {
  POST_KIND_SUGGESTIONS,
  emptyPostDraft,
  parseRelatedSlugs,
  postToDraft,
  stripHtml,
  suggestPostSlug,
  toPostBody,
  validatePostDraft,
  type PostDraft,
  type PostDraftErrors,
} from '../../features/icerik/postForm';
import { MediaPickerModal } from '../../features/medya/MediaPickerModal';
import { MediaThumb } from '../../features/medya/MediaThumb';
import { ApiError, errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminMediaFile } from '../../lib/adminTypes';
import type { AdminPost } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime, mergeFromServer } from '../../lib/utils';

const LIST_PATH = '/icerik/gunluk';

/** Ekran 11 — Günlük yazı formu: slug · tür · okuma süresi · başlık (HTML) · özet · gövde (RichTextLite) · kapak · ilgili yazılar · durum. */
export function AdminGunlukFormPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'yeni';
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [draft, setDraft] = useState<PostDraft>(emptyPostDraft);
  const [post, setPost] = useState<AdminPost | null>(null);
  const [others, setOthers] = useState<AdminPost[]>([]);
  const [errors, setErrors] = useState<PostDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await postsApi.list({ page: 1, limit: 100 }).catch(() => ({ items: [] as AdminPost[], total: 0 }));
      setOthers(list.items);
      if (!isNew && id) {
        const p = await postsApi.get(id);
        setPost(p);
        setDraft(postToDraft(p));
        setDirty(false);
      }
    } catch (e) {
      setLoadError(errorMessage(e, 'Yazı yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const patch = useCallback((p: Partial<PostDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...p };
      if (p.titleHtml !== undefined && !d.slugTouched) next.slug = suggestPostSlug(p.titleHtml);
      return next;
    });
    setDirty(true);
  }, []);

  async function handleSave(andClose: boolean) {
    const v = validatePostDraft(draft);
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError('Lütfen işaretli alanları düzeltin.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = toPostBody(draft);
    try {
      if (isNew) {
        const created = await postsApi.create(body);
        toast.success('Yazı oluşturuldu');
        setDirty(false);
        if (andClose || !created?.id) navigate(LIST_PATH);
        else navigate(`${LIST_PATH}/${created.id}`, { replace: true });
      } else if (id) {
        const updated = await postsApi.update(id, body);
        const merged: AdminPost = { ...(post ?? updated), ...updated, coverUrl: updated?.coverUrl ?? draft.coverUrl };
        setPost(merged);
        setDraft(postToDraft(merged));
        setDirty(false);
        toast.success('Yazı kaydedildi');
        if (andClose) navigate(LIST_PATH);
      }
    } catch (err) {
      const fe = extractFieldErrors(err) as PostDraftErrors;
      if (err instanceof ApiError && err.kind === 'conflict') fe.slug = err.message || 'Bu slug zaten kullanılıyor';
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!id || !post) return;
    if (dirty) {
      const ok = await confirm({ title: 'Önce kaydedin', description: 'Kaydedilmemiş değişiklikler var. Yayınlamadan önce kaydedilsin mi?', confirmLabel: 'Kaydet ve yayınla' });
      if (!ok) return;
      await handleSave(false);
    }
    setPublishing(true);
    try {
      const updated = await postsApi.publish(id);
      const merged = mergeFromServer<AdminPost>({ ...post, status: 'PUBLISHED', publishedAt: new Date().toISOString() }, updated);
      setPost(merged);
      setDraft(postToDraft(merged));
      setDirty(false);
      toast.success('Yazı yayınlandı');
    } catch (e) {
      toast.error(errorMessage(e, 'Yayınlanamadı'));
    } finally {
      setPublishing(false);
    }
  }

  async function handleDelete() {
    if (!id || !post) return;
    const ok = await confirm({ title: 'Yazıyı sil', description: `"${stripHtml(post.titleHtml)}" kalıcı olarak silinecek.`, confirmLabel: 'Sil', danger: true });
    if (!ok) return;
    try {
      await postsApi.remove(id);
      toast.success('Yazı silindi');
      setDirty(false);
      navigate(LIST_PATH);
    } catch (e) {
      toast.error(errorMessage(e, 'Silinemedi'));
    }
  }

  async function handleBack() {
    if (dirty) {
      const ok = await confirm({ title: 'Kaydedilmemiş değişiklikler', description: 'Değişiklikler kaydedilmeden çıkılsın mı?', confirmLabel: 'Çık', danger: true });
      if (!ok) return;
    }
    navigate(LIST_PATH);
  }

  function onPickCover(file: AdminMediaFile) {
    patch({ coverMediaId: file.id, coverUrl: file.url });
  }

  function addRelated(slug: string) {
    if (!slug) return;
    const current = parseRelatedSlugs(draft.relatedSlugsText);
    if (current.includes(slug)) return;
    patch({ relatedSlugsText: [...current, slug].join(', ') });
  }

  const title = isNew ? 'Yeni yazı' : stripHtml(post?.titleHtml ?? '') || 'Yazı düzenle';
  const relatedCandidates = others.filter((p) => p.slug !== draft.slug);

  if (loading) {
    return (
      <div className="px-4 py-4">
        <AdminPageHeader title="Günlük" crumb="Yükleniyor…" />
        <LoadingBlock />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="px-4 py-4">
        <AdminPageHeader title="Günlük" crumb="Hata" />
        <ErrorBlock message={loadError} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="px-4 pb-24 pt-4 sm:pb-6">
      <AdminPageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title}
            {!isNew && post && <ContentStatusBadge status={post.status} />}
          </span>
        }
        crumb={isNew ? 'Yeni' : title}
        description={
          isNew ? (
            'Başlık ve gövde zorunlu. Taslak olarak kaydedip sonra yayınlayabilirsiniz.'
          ) : post ? (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono">{post.slug}</span>
              {post.status === 'PUBLISHED' && (
                <a href={`/gunluk.html#${encodeURIComponent(post.slug)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  Sitede gör <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
              {post.publishedAt && <span>Yayın: {formatDateTime(post.publishedAt)}</span>}
              <span>Güncelleme: {formatDateTime(post.updatedAt)}</span>
            </span>
          ) : undefined
        }
        actions={
          <button type="button" onClick={() => void handleBack()} className={btn.secondary}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Listeye dön
          </button>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave(false);
        }}
        noValidate
        className="grid gap-4 lg:grid-cols-[1fr_18rem]"
      >
        <div className="space-y-6 rounded-lg border border-brand-200 bg-white p-4">
          <FormErrorBanner message={formError} />
          <FormSection title="Başlık ve kimlik">
            <Field label="Başlık (HTML)" required hint="gunluk.html h2 — vurgu için <em>…</em> kullanılabilir. Küçük harf üslubu sitede korunur." error={errors.titleHtml}>
              {({ id: fid, invalid }) => <TextInput id={fid} invalid={invalid} value={draft.titleHtml} onChange={(e) => patch({ titleHtml: e.target.value })} placeholder="bir annenin ekmeği, <em>iki sofrada</em>" />}
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem_7rem]">
              <Field label="Slug" required hint="gunluk.html#slug bağlantısı; küçük harf, rakam, tire." error={errors.slug}>
                {({ id: fid, invalid }) => (
                  <TextInput id={fid} invalid={invalid} value={draft.slug} className="font-mono" onChange={(e) => { setDraft((d) => ({ ...d, slug: e.target.value, slugTouched: true })); setDirty(true); }} />
                )}
              </Field>
              <Field label="Tür (rozet)" required hint="SÖYLEŞİ · MEVSİM · NOT …" error={errors.kind}>
                {({ id: fid, invalid }) => (
                  <>
                    <TextInput id={fid} invalid={invalid} list="post-kind-suggestions" value={draft.kind} onChange={(e) => patch({ kind: e.target.value })} />
                    <datalist id="post-kind-suggestions">
                      {POST_KIND_SUGGESTIONS.map((k) => (
                        <option key={k} value={k} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Field label="Okuma (dk)" required error={errors.readMinutes}>
                {({ id: fid, invalid }) => <TextInput id={fid} invalid={invalid} inputMode="numeric" value={draft.readMinutes} onChange={(e) => patch({ readMinutes: e.target.value })} />}
              </Field>
            </div>
          </FormSection>

          <FormSection title="Özet" description="Kart altındaki kısa metin (isteğe bağlı).">
            <Field error={errors.excerpt}>
              {({ id: fid, invalid }) => <TextArea id={fid} invalid={invalid} rows={3} value={draft.excerpt} onChange={(e) => patch({ excerpt: e.target.value })} />}
            </Field>
          </FormSection>

          <FormSection title="Gövde">
            <Field required error={errors.bodyHtml}>
              {({ id: fid, invalid }) => <RichTextLite id={fid} invalid={invalid} value={draft.bodyHtml} onChange={(html) => patch({ bodyHtml: html })} minHeight="20rem" aria-label="Gövde" />}
            </Field>
          </FormSection>
        </div>

        <aside className="space-y-4">
          <div className="space-y-3 rounded-lg border border-brand-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-brand-900">Yayın</h3>
            <Field label="Durum">
              {({ id: fid }) => (
                <Select id={fid} value={draft.status} onChange={(e) => patch({ status: e.target.value === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT' })}>
                  <option value="DRAFT">Taslak</option>
                  <option value="PUBLISHED">Yayında</option>
                </Select>
              )}
            </Field>
            {!isNew && post?.status !== 'PUBLISHED' && (
              <button type="button" onClick={() => void handlePublish()} disabled={publishing || saving} className={cn(btn.outline, 'w-full')}>
                <Send className="h-4 w-4" aria-hidden />
                {publishing ? 'Yayınlanıyor…' : 'Şimdi yayınla'}
              </button>
            )}
            {!isNew && post?.status === 'PUBLISHED' && <InlineNotice tone="success">Yazı yayında. Taslağa almak için durumu değiştirip kaydedin.</InlineNotice>}
          </div>

          <div className="space-y-2 rounded-lg border border-brand-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-brand-900">Kapak görseli</h3>
            <MediaThumb src={draft.coverUrl} alt="" className="h-36 w-full" />
            <div className="flex gap-1">
              <button type="button" onClick={() => setPickerOpen(true)} className={cn(btn.secondary, btn.sm, 'flex-1')}>
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                {draft.coverMediaId ? 'Değiştir' : 'Seç'}
              </button>
              {draft.coverMediaId && (
                <button type="button" onClick={() => patch({ coverMediaId: null, coverUrl: null })} className={btn.iconDanger} aria-label="Kapağı kaldır" title="Kaldır">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-brand-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-brand-900">İlgili yazılar</h3>
            <Field hint="Virgülle ayrılmış slug listesi." error={errors.relatedSlugsText}>
              {({ id: fid, invalid }) => <TextArea id={fid} invalid={invalid} rows={2} className="font-mono text-xs" value={draft.relatedSlugsText} onChange={(e) => patch({ relatedSlugsText: e.target.value })} />}
            </Field>
            {relatedCandidates.length > 0 && (
              <Select value="" aria-label="İlgili yazı ekle" onChange={(e) => addRelated(e.target.value)}>
                <option value="">+ Listeden ekle…</option>
                {relatedCandidates.map((p) => (
                  <option key={p.id} value={p.slug}>{stripHtml(p.titleHtml) || p.slug}</option>
                ))}
              </Select>
            )}
          </div>
        </aside>

        {/* Alt aksiyon çubuğu */}
        <div className="fixed inset-x-0 bottom-16 z-30 border-t border-brand-200 bg-white/95 px-4 py-2 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!isNew && (
              <button type="button" onClick={() => void handleDelete()} className={cn(btn.ghost, 'mr-auto text-accent-dark')}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Sil
              </button>
            )}
            {dirty && <span className="text-xs text-butter-deep">Kaydedilmemiş değişiklik var</span>}
            <button type="submit" disabled={saving} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button type="button" onClick={() => void handleSave(true)} disabled={saving} className={btn.secondary}>
              <SaveAll className="h-4 w-4" aria-hidden />
              Kaydet ve kapat
            </button>
          </div>
        </div>
      </form>

      <MediaPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={onPickCover} title="Kapak görseli seç" defaultFolder="gunluk" />
    </div>
  );
}
