import { ArrowLeft, Eye, Lock, Pencil, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Checkbox, Field, FormErrorBanner, FormSection, TextInput } from '../../components/ui/FormField';
import { RichTextLite } from '../../components/ui/RichTextLite';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminTabPanel } from '../../features/components/AdminTabPanel';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { legalApi } from '../../features/icerik/api';
import { ApiError, errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminLegalDocument, AdminLegalSlug } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime } from '../../lib/utils';
import { PublishModal, kindLabel } from './AdminYasalMetinlerPage';

const LIST_PATH = '/icerik/yasal-metinler';

interface Draft {
  title: string;
  leadHtml: string;
  bodyHtml: string;
  requiresAck: boolean;
  showInNav: boolean;
  sortOrder: string;
}

function emptyDraft(): Draft {
  return { title: '', leadHtml: '', bodyHtml: '', requiresAck: false, showInNav: false, sortOrder: '0' };
}

function docToDraft(d: AdminLegalDocument): Draft {
  return {
    title: d.title ?? '',
    leadHtml: d.leadHtml ?? '',
    bodyHtml: d.bodyHtml ?? '',
    requiresAck: !!d.requiresAck,
    showInNav: !!d.showInNav,
    sortOrder: String(d.sortOrder ?? 0),
  };
}

function validate(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.title.trim()) e.title = 'Başlık zorunlu';
  else if (d.title.trim().length > 160) e.title = 'En fazla 160 karakter';
  if (!d.bodyHtml.replace(/<[^>]+>/g, '').trim()) e.bodyHtml = 'Gövde zorunlu';
  if (!/^\d+$/.test(d.sortOrder.trim())) e.sortOrder = 'Tam sayı (0 ya da büyük)';
  return e;
}

/**
 * Ekran 12 — Yasal belge sürümü: yeni taslak (`/yeni?slug=&from=`) ya da mevcut sürüm (`/:id`).
 * Yayındaki sürümde başlık/gövde salt-okunur (sunucu 409); nav/sıra/onay her sürümde PATCH ile değişir.
 */
export function AdminYasalFormPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const isNew = !id || id === 'yeni';
  const slugParam = params.get('slug') ?? '';
  const fromId = params.get('from');
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [doc, setDoc] = useState<AdminLegalDocument | null>(null);
  const [slugMeta, setSlugMeta] = useState<AdminLegalSlug | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [initialNav, setInitialNav] = useState<Pick<Draft, 'requiresAck' | 'showInNav' | 'sortOrder'>>({ requiresAck: false, showInNav: false, sortOrder: '0' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'duzenle' | 'onizleme'>('duzenle');
  const [publishOpen, setPublishOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await legalApi.list().catch(() => [] as AdminLegalSlug[]);
      if (!isNew && id) {
        const d = await legalApi.get(id);
        setDoc(d);
        const dr = docToDraft(d);
        setDraft(dr);
        setInitialNav({ requiresAck: dr.requiresAck, showInNav: dr.showInNav, sortOrder: dr.sortOrder });
        setSlugMeta(list.find((s) => s.slug === d.slug) ?? null);
      } else {
        const meta = list.find((s) => s.slug === slugParam) ?? null;
        setSlugMeta(meta);
        if (fromId) {
          const base = await legalApi.get(fromId);
          const dr = docToDraft(base);
          setDraft(dr);
          setInitialNav({ requiresAck: dr.requiresAck, showInNav: dr.showInNav, sortOrder: dr.sortOrder });
        } else if (meta) {
          const cur = meta.versions.find((v) => v.isCurrent) ?? meta.versions[0];
          setDraft({ ...emptyDraft(), title: cur?.title ?? meta.title, requiresAck: !!cur?.requiresAck, showInNav: !!cur?.showInNav, sortOrder: String(cur?.sortOrder ?? 0) });
        }
      }
      setDirty(false);
    } catch (e) {
      setLoadError(errorMessage(e, 'Belge yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [id, isNew, slugParam, fromId]);

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

  const locked = !!doc?.isCurrent;
  const slug = doc?.slug ?? slugParam;

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    const v = validate(draft);
    if (locked) {
      delete v.title;
      delete v.bodyHtml;
    }
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError('Lütfen işaretli alanları düzeltin.');
      setTab('duzenle');
      return;
    }
    if (isNew && !slug) {
      setFormError('Belge slug’ı eksik; listeden “Yeni taslak sürüm” ile gelin.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (isNew) {
        const created = await legalApi.createVersion(slug, {
          title: draft.title.trim(),
          leadHtml: draft.leadHtml.trim() || null,
          bodyHtml: draft.bodyHtml,
          requiresAck: draft.requiresAck,
          showInNav: draft.showInNav,
          sortOrder: Number(draft.sortOrder),
        });
        toast.success(`Taslak sürüm oluşturuldu${created?.version ? ` (v${created.version})` : ''}`);
        setDirty(false);
        if (created?.id) navigate(`${LIST_PATH}/${created.id}`, { replace: true });
        else navigate(LIST_PATH);
        return;
      }
      if (!id || !doc) return;
      let next: AdminLegalDocument = doc;
      if (!locked) {
        const updated = await legalApi.update(id, { title: draft.title.trim(), leadHtml: draft.leadHtml.trim() || null, bodyHtml: draft.bodyHtml });
        next = { ...next, ...(updated ?? {}), title: draft.title.trim(), leadHtml: draft.leadHtml.trim() || null, bodyHtml: draft.bodyHtml };
      }
      const navChanged = draft.requiresAck !== initialNav.requiresAck || draft.showInNav !== initialNav.showInNav || draft.sortOrder !== initialNav.sortOrder;
      if (navChanged) {
        const body = { requiresAck: draft.requiresAck, showInNav: draft.showInNav, sortOrder: Number(draft.sortOrder) };
        const res = await legalApi.patchNav(id, body);
        next = { ...next, ...body, ...(res ?? {}) };
        setInitialNav({ requiresAck: draft.requiresAck, showInNav: draft.showInNav, sortOrder: draft.sortOrder });
      }
      setDoc(next);
      setDraft(docToDraft(next));
      setDirty(false);
      toast.success('Kaydedildi');
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      if (err instanceof ApiError && err.kind === 'conflict') setFormError(err.message || 'Yayındaki sürüm düzenlenemez; yeni taslak sürüm oluşturun.');
      else setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  async function handleBack() {
    if (dirty) {
      const ok = await confirm({ title: 'Kaydedilmemiş değişiklikler', description: 'Değişiklikler kaydedilmeden çıkılsın mı?', confirmLabel: 'Çık', danger: true });
      if (!ok) return;
    }
    navigate(LIST_PATH);
  }

  async function openPublish() {
    if (!doc) return;
    if (dirty) {
      const ok = await confirm({ title: 'Önce kaydedin', description: 'Kaydedilmemiş değişiklikler var. Yayınlamadan önce kaydedilsin mi?', confirmLabel: 'Kaydet' });
      if (!ok) return;
      await handleSave();
    }
    setPublishOpen(true);
  }

  const title = isNew ? `Yeni taslak sürüm${slugMeta ? ` — ${slugMeta.title}` : ''}` : doc ? `${doc.title} · v${doc.version}` : 'Belge';

  if (loading) {
    return (
      <div className="px-4 py-4">
        <AdminPageHeader title="Yasal Metinler" crumb="Yükleniyor…" />
        <LoadingBlock />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="px-4 py-4">
        <AdminPageHeader title="Yasal Metinler" crumb="Hata" />
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
            {doc && (
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', doc.isCurrent ? 'bg-olive-soft text-olive-deep ring-olive/30' : 'bg-butter/50 text-butter-deep ring-butter-deep/30')}>
                {doc.isCurrent && <Lock className="h-3 w-3" aria-hidden />}
                {doc.isCurrent ? 'Yayında' : 'Taslak'}
              </span>
            )}
          </span>
        }
        crumb={isNew ? 'Yeni sürüm' : doc ? `v${doc.version}` : undefined}
        description={
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono">{slug}</span>
            {(doc?.kind || slugMeta?.kind) && <span>{kindLabel(doc?.kind ?? slugMeta?.kind ?? '')}</span>}
            {doc && <span>Yürürlük: {formatDateTime(doc.effectiveFrom)}</span>}
            {doc?.contentHash && <span className="font-mono text-[10px] text-brand-400" title="SHA-256 (contentHash)">#{doc.contentHash.slice(0, 12)}…</span>}
          </span>
        }
        actions={
          <>
            <button type="button" onClick={() => void handleBack()} className={btn.secondary}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Listeye dön
            </button>
            {doc && !doc.isCurrent && (
              <button type="button" onClick={() => void openPublish()} disabled={saving} className={btn.outline}>
                <Send className="h-4 w-4" aria-hidden />
                Yayınla
              </button>
            )}
          </>
        }
      />

      {locked && (
        <InlineNotice tone="info" className="mb-3">
          Bu sürüm yayında: başlık ve gövde değiştirilemez (onay kayıtları bu metne bağlı). Değişiklik için listeden <strong>Yeni taslak sürüm</strong> oluşturun. Nav / sıra / onay alanları düzenlenebilir.
        </InlineNotice>
      )}

      <form onSubmit={(e) => void handleSave(e)} noValidate className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="rounded-lg border border-brand-200 bg-white p-4">
          <FormErrorBanner message={formError} />
          <AdminTabPanel
            tabs={[
              { key: 'duzenle', label: 'Düzenle', hasError: !!(errors.title || errors.bodyHtml) },
              { key: 'onizleme', label: 'Önizleme' },
            ]}
            activeTab={tab}
            onTabChange={(k) => setTab(k as 'duzenle' | 'onizleme')}
          >
            {tab === 'duzenle' ? (
              <div className="space-y-5">
                <Field label="Başlık" required error={errors.title}>
                  {({ id: fid, invalid }) => <TextInput id={fid} invalid={invalid} value={draft.title} maxLength={160} disabled={locked} onChange={(e) => patch({ title: e.target.value })} />}
                </Field>
                <Field label="Giriş (lead, HTML)" hint="Belge başındaki kısa açıklama; isteğe bağlı." error={errors.leadHtml}>
                  {({ id: fid, invalid }) => <RichTextLite id={fid} invalid={invalid} value={draft.leadHtml} disabled={locked} minHeight="5rem" compact onChange={(html) => patch({ leadHtml: html })} aria-label="Giriş" />}
                </Field>
                <Field label="Gövde (HTML)" required error={errors.bodyHtml}>
                  {({ id: fid, invalid }) => <RichTextLite id={fid} invalid={invalid} value={draft.bodyHtml} disabled={locked} minHeight="24rem" onChange={(html) => patch({ bodyHtml: html })} aria-label="Gövde" />}
                </Field>
              </div>
            ) : (
              <article className="rounded-md border border-brand-200 bg-brand-50/40 p-4">
                <h2 className="mb-2 text-lg font-semibold text-brand-900">{draft.title || '(başlıksız)'}</h2>
                {draft.leadHtml && <div className="rich-text-content mb-3 text-sm text-brand-700" dangerouslySetInnerHTML={{ __html: draft.leadHtml }} />}
                <div className="rich-text-content text-sm text-brand-900" dangerouslySetInnerHTML={{ __html: draft.bodyHtml || '<p><em>Gövde boş.</em></p>' }} />
              </article>
            )}
          </AdminTabPanel>
        </div>

        <aside className="space-y-4">
          <FormSection title="Nav / sıra / onay" description="politikalar.html nav'ı ve checkout onayı." className="rounded-lg border border-brand-200 bg-white p-4">
            <Checkbox label="Nav'da göster" description="8 politika nav'da; diğerleri hash/link ile." checked={draft.showInNav} onChange={(e) => patch({ showInNav: e.target.checked })} />
            <Checkbox label="Checkout'ta onay zorunlu" checked={draft.requiresAck} onChange={(e) => patch({ requiresAck: e.target.checked })} />
            <Field label="Nav sırası" error={errors.sortOrder}>
              {({ id: fid, invalid }) => <TextInput id={fid} invalid={invalid} inputMode="numeric" value={draft.sortOrder} onChange={(e) => patch({ sortOrder: e.target.value })} />}
            </Field>
          </FormSection>
          {doc && (
            <div className="space-y-1 rounded-lg border border-brand-200 bg-white p-4 text-xs text-brand-600">
              <p><span className="font-medium text-brand-800">Sürüm:</span> v{doc.version}</p>
              <p><span className="font-medium text-brand-800">Oluşturma:</span> {formatDateTime(doc.createdAt)}</p>
              <p><span className="font-medium text-brand-800">Yürürlük:</span> {formatDateTime(doc.effectiveFrom)}</p>
              <p className="break-all"><span className="font-medium text-brand-800">contentHash:</span> <span className="font-mono">{doc.contentHash}</span></p>
            </div>
          )}
        </aside>

        <div className="fixed inset-x-0 bottom-16 z-30 border-t border-brand-200 bg-white/95 px-4 py-2 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && <span className="text-xs text-butter-deep">Kaydedilmemiş değişiklik var</span>}
            <button type="button" onClick={() => setTab(tab === 'duzenle' ? 'onizleme' : 'duzenle')} className={btn.secondary}>
              {tab === 'duzenle' ? <Eye className="h-4 w-4" aria-hidden /> : <Pencil className="h-4 w-4" aria-hidden />}
              {tab === 'duzenle' ? 'Önizleme' : 'Düzenle'}
            </button>
            <button type="submit" disabled={saving} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : isNew ? 'Taslağı oluştur' : 'Kaydet'}
            </button>
          </div>
        </div>
      </form>

      <PublishModal
        target={publishOpen && doc ? { slug: { slug: doc.slug, kind: doc.kind, title: doc.title, currentVersion: null, versions: [] }, row: doc } : null}
        onClose={() => setPublishOpen(false)}
        onPublished={(_slug, row) => {
          setPublishOpen(false);
          setDoc((prev) => (prev ? { ...prev, isCurrent: true, effectiveFrom: row.effectiveFrom ?? prev.effectiveFrom } : prev));
        }}
      />
    </div>
  );
}
