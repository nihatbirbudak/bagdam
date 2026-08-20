import { ChevronDown, ChevronUp, ExternalLink, FilePlus2, Pencil, Scale, Send, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LEGAL_KIND_LABELS, type LegalKind } from '@bagdam/shared';
import { Checkbox, Field, FormErrorBanner, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { BoolBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { legalApi } from '../../features/icerik/api';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminLegalSlug, AdminLegalVersionRow } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime, mergeFromServer } from '../../lib/utils';

/** `datetime-local` giriş değeri (yerel saat, dakika hassasiyeti). */
export function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function kindLabel(kind: string): string {
  return (LEGAL_KIND_LABELS as Record<string, string>)[kind as LegalKind] ?? kind;
}

type PublishTarget = { slug: AdminLegalSlug; row: AdminLegalVersionRow };
type NavTarget = { slug: AdminLegalSlug; row: AdminLegalVersionRow };

/**
 * Ekran 12 — Yasal Metinler: slug başına sürümler; yeni taslak sürüm, düzenle (taslak), yayınla (effectiveFrom),
 * nav/sıra/onay zorunluluğu. Gövde düzenleme ayrı sayfada (`/icerik/yasal-metinler/:id`).
 */
export function AdminYasalMetinlerPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AdminLegalSlug[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [publishTarget, setPublishTarget] = useState<PublishTarget | null>(null);
  const [navTarget, setNavTarget] = useState<NavTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await legalApi.list();
      setItems(
        [...list]
          .map((s) => ({ ...s, versions: [...(s.versions ?? [])].sort((a, b) => b.version - a.version) }))
          .sort((a, b) => {
            const an = a.versions.find((v) => v.isCurrent);
            const bn = b.versions.find((v) => v.isCurrent);
            const as = an ? (an.showInNav ? 0 : 1) : 2;
            const bs = bn ? (bn.showInNav ? 0 : 1) : 2;
            if (as !== bs) return as - bs;
            return (an?.sortOrder ?? 0) - (bn?.sortOrder ?? 0) || a.title.localeCompare(b.title, 'tr');
          }),
      );
    } catch (e) {
      setError(errorMessage(e, 'Yasal metinler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const navCount = useMemo(() => items.filter((s) => s.versions.some((v) => v.isCurrent && v.showInNav)).length, [items]);

  function toggle(slug: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  /**
   * Yerel güncelleme: `publish` → hedef sürüm isCurrent, diğerleri değil; `nav` → nav/sıra/onay slug'ın TÜM sürümlerine
   * uygulanır (sunucu kuralı: PATCH /admin/legal/:id/nav slug düzeyinde); `row` → yalnız hedef satır.
   */
  function applyRow(slug: string, updated: Partial<AdminLegalVersionRow> & { id: string }, scope: 'row' | 'publish' | 'nav' = 'row') {
    const navPatch = { showInNav: updated.showInNav, requiresAck: updated.requiresAck, sortOrder: updated.sortOrder };
    setItems((prev) =>
      prev.map((s) =>
        s.slug !== slug
          ? s
          : {
              ...s,
              currentVersion: scope === 'publish' ? (s.versions.find((v) => v.id === updated.id)?.version ?? s.currentVersion) : s.currentVersion,
              ...(scope === 'nav'
                ? {
                    showInNav: navPatch.showInNav ?? s.showInNav,
                    requiresAck: navPatch.requiresAck ?? s.requiresAck,
                    sortOrder: navPatch.sortOrder ?? s.sortOrder,
                  }
                : {}),
              versions: s.versions.map((v) => {
                if (v.id === updated.id) return { ...v, ...updated, ...(scope === 'publish' ? { isCurrent: true } : {}) };
                if (scope === 'publish') return { ...v, isCurrent: false };
                if (scope === 'nav')
                  return {
                    ...v,
                    showInNav: navPatch.showInNav ?? v.showInNav,
                    requiresAck: navPatch.requiresAck ?? v.requiresAck,
                    sortOrder: navPatch.sortOrder ?? v.sortOrder,
                  };
                return v;
              }),
            },
      ),
    );
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Yasal Metinler"
        description="Belge başına sürümler: yayındaki sürüm değiştirilemez; yeni taslak sürüm oluşturup yayınlayın. politikalar.html nav'ında showInNav=true olanlar (8 politika); diğerleri (ön bilgilendirme, abonelik sözleşmesi, ticari ileti izni) bağlantı/hash ile."
        actions={
          <a href="/politikalar.html" target="_blank" rel="noopener noreferrer" className={btn.secondary}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            Sitede gör
          </a>
        }
      />

      {!loading && !error && items.length > 0 && (
        <InlineNotice tone={navCount === 8 ? 'info' : 'warning'} className="mb-3">
          Nav'da gösterilen yayındaki belge sayısı: <strong>{navCount}</strong> (beklenen 8).
        </InlineNotice>
      )}

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={Scale} message="Yasal belge bulunamadı (içerik seed'i F5 — `pnpm db:seed`)." />
      ) : (
        <div className="space-y-3">
          {items.map((s) => {
            const current = s.versions.find((v) => v.isCurrent) ?? null;
            const isCollapsed = collapsed.has(s.slug);
            return (
              <section key={s.slug} className="rounded-lg border border-brand-200 bg-white">
                <header className="flex flex-wrap items-center gap-2 border-b border-brand-200 bg-brand-50 px-4 py-2.5">
                  <button type="button" onClick={() => toggle(s.slug)} className="inline-flex h-6 w-6 items-center justify-center rounded text-brand-500 hover:bg-brand-100" aria-expanded={!isCollapsed} aria-label={isCollapsed ? 'Sürümleri göster' : 'Sürümleri gizle'}>
                    {isCollapsed ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-brand-900">
                      {current?.title ?? s.title}
                      <span className="ml-2 font-mono text-[11px] font-normal text-brand-400">{s.slug}</span>
                    </h2>
                    <p className="text-[11px] text-brand-500">
                      {kindLabel(s.kind)} · yayındaki sürüm: {current ? `v${current.version}` : <span className="text-accent-dark">yok</span>}
                      {current && (
                        <>
                          {' · '}
                          {current.showInNav ? 'nav’da' : 'nav dışı (hash/link)'}
                          {current.requiresAck ? ' · onay zorunlu' : ''}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/icerik/yasal-metinler/yeni?slug=${encodeURIComponent(s.slug)}${current ? `&from=${encodeURIComponent(current.id)}` : ''}`)}
                    className={cn(btn.secondary, btn.sm)}
                  >
                    <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
                    Yeni taslak sürüm
                  </button>
                </header>
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th className={cn(th, 'w-16')}>Sürüm</th>
                          <th className={th}>Başlık</th>
                          <th className={th}>Durum</th>
                          <th className={th}>Yürürlük</th>
                          <th className={th}>Nav</th>
                          <th className={th}>Onay</th>
                          <th className={cn(th, 'text-right')}>Sıra</th>
                          <th className={th}>Oluşturma</th>
                          <th className={cn(th, 'w-px')}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.versions.map((v) => (
                          <tr key={v.id} className={cn(!v.isCurrent && 'bg-brand-50/40')}>
                            <td className={cn(td, 'font-mono')}>v{v.version}</td>
                            <td className={cn(td, 'max-w-[24rem]')}>
                              <Link to={`/icerik/yasal-metinler/${v.id}`} className="font-medium text-brand-900 hover:text-accent">{v.title}</Link>
                            </td>
                            <td className={td}>
                              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', v.isCurrent ? 'bg-olive-soft text-olive-deep ring-olive/30' : 'bg-butter/50 text-butter-deep ring-butter-deep/30')}>
                                {v.isCurrent ? 'Yayında' : 'Taslak'}
                              </span>
                            </td>
                            <td className={cn(td, 'text-xs')}>{formatDateTime(v.effectiveFrom)}</td>
                            <td className={td}><BoolBadge value={v.showInNav} yes="Nav" no="Hash" /></td>
                            <td className={td}><BoolBadge value={v.requiresAck} yes="Zorunlu" no="—" /></td>
                            <td className={cn(td, 'text-right')}>{v.sortOrder}</td>
                            <td className={cn(td, 'text-xs')}>{formatDateTime(v.createdAt)}</td>
                            <td className={td}>
                              <div className="flex items-center gap-1">
                                {!v.isCurrent && (
                                  <button type="button" onClick={() => setPublishTarget({ slug: s, row: v })} className={cn(btn.secondary, btn.sm)} title="Yayınla">
                                    <Send className="h-3.5 w-3.5" aria-hidden />
                                    Yayınla
                                  </button>
                                )}
                                <button type="button" onClick={() => setNavTarget({ slug: s, row: v })} className={btn.icon} aria-label="Nav / sıra / onay" title="Nav / sıra / onay">
                                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <Link to={`/icerik/yasal-metinler/${v.id}`} className={btn.icon} aria-label={v.isCurrent ? 'Görüntüle' : 'Düzenle'} title={v.isCurrent ? 'Görüntüle' : 'Düzenle'}>
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <PublishModal
        target={publishTarget}
        onClose={() => setPublishTarget(null)}
        onPublished={(slug, row) => {
          applyRow(slug, row, 'publish');
          setPublishTarget(null);
        }}
      />
      <NavModal
        target={navTarget}
        onClose={() => setNavTarget(null)}
        onSaved={(slug, row) => {
          applyRow(slug, row, 'nav');
          setNavTarget(null);
        }}
      />
    </div>
  );
}

/** Yayınla: effectiveFrom (varsayılan şimdi) → `POST /admin/legal/:id/publish`. */
export function PublishModal({
  target,
  onClose,
  onPublished,
}: {
  target: PublishTarget | null;
  onClose: () => void;
  onPublished: (slug: string, row: Partial<AdminLegalVersionRow> & { id: string }) => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(() => toDateTimeLocal(new Date()));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setEffectiveFrom(toDateTimeLocal(new Date()));
      setFormError(null);
    }
  }, [target]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    const d = effectiveFrom ? new Date(effectiveFrom) : new Date();
    if (Number.isNaN(d.getTime())) {
      setFormError('Geçerli bir tarih-saat girin.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await legalApi.publish(target.row.id, { effectiveFrom: d.toISOString() });
      onPublished(target.slug.slug, { id: target.row.id, isCurrent: true, effectiveFrom: res?.effectiveFrom ?? d.toISOString() });
      toast.success(`v${target.row.version} yayınlandı; önceki sürüm yayından kalktı`);
    } catch (err) {
      setFormError(errorMessage(err, 'Yayınlanamadı'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target ? `Yayınla — ${target.slug.title} v${target.row.version}` : ''}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className={btn.secondary}>İptal</button>
          <button type="submit" form="legal-publish-form" disabled={saving} className={btn.primary}>
            <Send className="h-4 w-4" aria-hidden />
            {saving ? 'Yayınlanıyor…' : 'Yayınla'}
          </button>
        </>
      }
    >
      {target && (
        <form id="legal-publish-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormErrorBanner message={formError} />
          <p className="text-sm text-brand-700">
            Bu sürüm yayına alınacak; aynı belgenin diğer sürümleri yayından kalkacak. Onay kayıtları (Consent) bu sürümün içerik özetine bağlanır.
          </p>
          <Field label="Yürürlük tarihi" hint="Boş bırakılırsa şimdi.">
            {({ id }) => <TextInput id={id} type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />}
          </Field>
        </form>
      )}
    </Modal>
  );
}

/** Nav / sıra / onay: `PATCH /admin/legal/:id/nav`. */
export function NavModal({
  target,
  onClose,
  onSaved,
}: {
  target: NavTarget | null;
  onClose: () => void;
  onSaved: (slug: string, row: Partial<AdminLegalVersionRow> & { id: string }) => void;
}) {
  const [showInNav, setShowInNav] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);
  const [sortOrder, setSortOrder] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setShowInNav(target.row.showInNav);
      setRequiresAck(target.row.requiresAck);
      setSortOrder(String(target.row.sortOrder ?? 0));
      setErrors({});
      setFormError(null);
    }
  }, [target]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (!/^\d+$/.test(sortOrder.trim())) {
      setErrors({ sortOrder: 'Tam sayı (0 ya da büyük)' });
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = { showInNav, requiresAck, sortOrder: Number(sortOrder) };
    try {
      const res = await legalApi.patchNav(target.row.id, body);
      onSaved(target.slug.slug, mergeFromServer<{ id: string } & typeof body>({ id: target.row.id, ...body }, res));
      toast.success('Nav ayarları kaydedildi');
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target ? `Nav / sıra / onay — ${target.slug.title} v${target.row.version}` : ''}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className={btn.secondary}>İptal</button>
          <button type="submit" form="legal-nav-form" disabled={saving} className={btn.primary}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      {target && (
        <form id="legal-nav-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormErrorBanner message={formError} />
          <p className="text-xs text-brand-500">Nav / sıra / onay belge (slug) düzeyinde özelliktir: değişiklik bu belgenin tüm sürümlerine uygulanır.</p>
          <Checkbox label="politikalar.html nav'ında göster" description="8 politika nav'da; ön bilgilendirme / abonelik sözleşmesi / ticari ileti izni hash ile." checked={showInNav} onChange={(e) => setShowInNav(e.target.checked)} />
          <Checkbox label="Checkout'ta açık onay gerektirir" description="Mesafeli satış / ön bilgilendirme / abonelik sözleşmesi gibi belgeler." checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />
          <Field label="Nav sırası" error={errors.sortOrder}>
            {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />}
          </Field>
        </form>
      )}
    </Modal>
  );
}
