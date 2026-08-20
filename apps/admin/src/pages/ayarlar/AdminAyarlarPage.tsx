import { Send, Settings } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TextInput } from '../../components/ui/FormField';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { SettingsGroupForm } from '../../features/ayarlar/SettingsGroupForm';
import { settingsApi } from '../../features/ayarlar/api';
import { SETTINGS_GROUP_LABELS } from '../../features/ayarlar/settingsForm';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminTabPanel } from '../../features/components/AdminTabPanel';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { describeMailSendResult } from '../../features/sistem/mailLogs';
import { ApiError, errorMessage } from '../../lib/api';
import type { AdminSettingGroup } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';

type GroupsViewProps = {
  title: string;
  description: ReactNode;
  /** Gösterilecek gruplar (sıra korunur). */
  groups: string[];
  /** Grup başına alt çubuk ek aksiyonu. */
  footerExtra?: (group: AdminSettingGroup) => ReactNode;
};

/**
 * Generic ayar grupları görünümü (UA kalıbı): `GET /admin/settings` → istenen gruplar sekme olarak; her sekme
 * registry'den üretilen `SettingsGroupForm`. Sekme `?grup=` parametresiyle kalıcı.
 */
export function SettingsGroupsView({ title, description, groups, footerExtra }: GroupsViewProps) {
  const [params, setParams] = useSearchParams();
  const [all, setAll] = useState<AdminSettingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAll(await settingsApi.list());
    } catch (e) {
      setError(errorMessage(e, 'Ayarlar yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => groups.map((g) => all.find((x) => x.group === g)).filter(Boolean) as AdminSettingGroup[], [all, groups]);
  const missing = useMemo(() => groups.filter((g) => !all.some((x) => x.group === g)), [all, groups]);
  const requested = params.get('grup');
  const activeKey = requested && visible.some((g) => g.group === requested) ? requested : (visible[0]?.group ?? '');
  const active = visible.find((g) => g.group === activeKey) ?? null;

  function selectTab(key: string) {
    const next = new URLSearchParams(params);
    if (key === visible[0]?.group) next.delete('grup');
    else next.set('grup', key);
    setParams(next, { replace: true });
  }

  function onSaved(updated: AdminSettingGroup) {
    setAll((prev) => prev.map((g) => (g.group === updated.group ? updated : g)));
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader title={title} description={description} />
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <AdminEmptyState icon={Settings} message={`Ayar grubu bulunamadı (${groups.join(', ')}). Settings registry (B) ve seed kontrol edilmeli.`} />
      ) : (
        <>
          {missing.length > 0 && (
            <InlineNotice tone="warning" className="mb-3">
              Registry'de tanımsız grup(lar): {missing.map((m) => SETTINGS_GROUP_LABELS[m] ?? m).join(', ')}.
            </InlineNotice>
          )}
          {visible.length > 1 ? (
            <AdminTabPanel tabs={visible.map((g) => ({ key: g.group, label: g.label }))} activeTab={activeKey} onTabChange={selectTab}>
              {active && <SettingsGroupForm key={active.group} group={active} onSaved={onSaved} footerExtra={footerExtra?.(active)} />}
            </AdminTabPanel>
          ) : (
            active && <SettingsGroupForm key={active.group} group={active} onSaved={onSaved} footerExtra={footerExtra?.(active)} />
          )}
        </>
      )}
    </div>
  );
}

/** Ekran 14a — Ayarlar › Genel: ticaret/kampanya (ADR-0018 üç kural dahil), site, çerezler. */
export function AdminAyarlarGenelPage() {
  return (
    <SettingsGroupsView
      title="Genel Ayarlar"
      description="Ticaret/kampanya kuralları (KDV, ilk kutu indirimi, kesim, tahsilat stratejisi, ADR-0018: eşik kuralı / indirim yuvarlama / abone kargo), site kimliği ve çerez bayrakları. Kargo ücreti/eşik Bölgeler'de (tek sahip DeliveryZone)."
      groups={['commerce', 'site', 'cookies']}
    />
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Test e-postası: alıcı + gönder → `POST /admin/settings/mail/test {to}` (F6 MailModule). Yanıt durumuna göre mesaj:
 * SENT başarı · SKIPPED (DISABLE_MAIL) bilgi + önizleme dosyası yolu · FAILED hata. API 501 dönerse (MailModule bağlı değil) bilgi.
 * SettingsGroupForm'un `<form>`u içinde render edilir → iç içe form yok; Enter tuşu gönderimi tetikler.
 */
export function MailTestForm({ defaultTo = '' }: { defaultTo?: string }) {
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  async function run() {
    const addr = to.trim();
    if (!EMAIL_RE.test(addr)) {
      setError('Geçerli bir e-posta girin');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const d = describeMailSendResult(await settingsApi.testMail({ to: addr }));
      toast[d.tone](d.message);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 501 || /F6/.test(e.message))) {
        toast.info('E-posta gönderimi (MailModule) henüz bağlı değil; ayarlar şimdiden kaydedilebilir.');
      } else {
        toast.error(errorMessage(e, 'Test gönderilemedi'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={inputId} className="sr-only">Test alıcısı</label>
      <TextInput
        id={inputId}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="test@ornek.com"
        value={to}
        invalid={!!error}
        disabled={busy}
        className="w-56 py-1.5 text-xs"
        onChange={(e) => {
          setTo(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void run();
          }
        }}
      />
      <button type="button" onClick={() => void run()} disabled={busy} className={btn.secondary}>
        <Send className="h-4 w-4" aria-hidden />
        {busy ? 'Gönderiliyor…' : 'Test e-postası gönder'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-accent-dark">
          {error}
        </span>
      )}
    </div>
  );
}

/** Varsayılan alıcı: oturumdaki yönetici. */
function MailTestFooter() {
  const { user } = useAdminAuth();
  return <MailTestForm defaultTo={user?.email ?? ''} />;
}

/** Ekran 15 — E-posta / SMS: sağlayıcı ayarları (parolalar şifreli, maskeli), test gönderimi (F6 MailModule; DISABLE_MAIL'de önizleme). */
export function AdminEpostaPage() {
  return (
    <SettingsGroupsView
      title="E-posta / SMS"
      description="SMTP / Resend / SES ve Netgsm ayarları. Gizli alanlar sunucuda AES-256-GCM ile şifrelenir, panelde maskeli görünür; yalnız “Değiştir” ile yeni değer gönderilir. .env SMTP değerleri yedek kaynaktır (ADR-0014)."
      groups={['mail', 'sms']}
      footerExtra={(g) => (g.group === 'mail' ? <MailTestFooter /> : null)}
    />
  );
}

/** Ekran 15 — Ödeme: iyzico anahtarları (şifreli), taban URL, NON3D yetkisi, açık/kapalı. */
export function AdminOdemePage() {
  return (
    <SettingsGroupsView
      title="Ödeme"
      description="iyzico API/gizli anahtarları (şifreli, maskeli) ve taban URL (sandbox/prod). NON3D yetkisi teyit edilince tahsilat stratejisi Genel › Ticaret'ten MERCHANT_INITIATED yapılır (F11)."
      groups={['payment']}
    />
  );
}

/** Ekran 15 — SEO: sayfa başlıkları/açıklama/OG görseli (Setting seo.*; sitemap/robots API'den üretilir). */
export function AdminSeoPage() {
  return (
    <SettingsGroupsView
      title="SEO"
      description="Sayfa başlıkları, açıklama ve OG görseli (Setting seo.*). sitemap.xml ve robots.txt API tarafından üretilir; burada düzenlenmez."
      groups={['seo']}
    />
  );
}
