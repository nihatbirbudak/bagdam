import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminTabPanel } from '../../features/components/AdminTabPanel';
import { SYSTEM_TABS, normalizeTab } from '../../features/sistem/system';
import { CronTab, DenetimTab, EpostaTab, SistemLogTab, WebhookTab } from './LogTabs';
import { SaglikTab } from './SaglikTab';

/**
 * Ekran 22 — Sistem (F10). Tek sayfada altı sekme:
 *   Sağlık  → `GET /admin/health/detailed` + iş kayıt defteri (`/admin/jobs`) + elle çalıştırma (dev/staging)
 *   Denetim → `GET /admin/audit-logs`      (AuditLog; kalıcı, asla silinmez)
 *   Sistem  → `GET /admin/system-logs`     (5xx + servis hataları; 30 gün)
 *   Cron    → `GET /admin/cron-logs`       (job koşuları; 90 gün)
 *   E-posta → `GET /admin/mail-logs`       (MailLog; 90 gün — ayrıntılı ekran Sistem › E-posta Günlüğü)
 *   Webhook → `GET /admin/webhook-events`  (ödeme bildirimleri; gövde redakte)
 *
 * Aktif sekme `?sekme=` ile URL'de tutulur; sekme değişince liste filtreleri (`page`, `limit`, `q`, `f`) sıfırlanır.
 * Tüm sekmeler salt okunur — günlük satırları panelden değiştirilemez (saklama süreleri `kvkk:purge` job'unda).
 */
export function AdminSistemPage() {
  const [params, setParams] = useSearchParams();
  const tab = normalizeTab(params.get('sekme'));

  const onTabChange = useCallback(
    (key: string) => {
      const next = new URLSearchParams();
      if (key !== 'saglik') next.set('sekme', key);
      setParams(next, { replace: true });
    },
    [setParams],
  );

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Sistem"
        description="Denetim, sistem, cron, e-posta ve webhook günlükleri + sağlık kartı. Saklama: denetim kalıcı · sistem 30 gün · cron ve e-posta 90 gün (KVKK saklama matrisi, kvkk:purge)."
      />

      <AdminTabPanel tabs={SYSTEM_TABS.map((t) => ({ key: t.key, label: t.label }))} activeTab={tab} onTabChange={onTabChange}>
        {tab === 'saglik' && <SaglikTab />}
        {tab === 'denetim' && <DenetimTab />}
        {tab === 'sistem' && <SistemLogTab />}
        {tab === 'cron' && <CronTab />}
        {tab === 'eposta' && <EpostaTab />}
        {tab === 'webhook' && <WebhookTab />}
      </AdminTabPanel>
    </div>
  );
}
