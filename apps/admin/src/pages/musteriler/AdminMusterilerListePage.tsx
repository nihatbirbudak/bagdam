import { USER_ROLE_LABELS, USER_ROLE_VALUES, type UserRole } from '@bagdam/shared';
import { Eye, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { BoolBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { customersApi } from '../../features/musteriler/api';
import { CustomerStateBadge, RoleBadge } from '../../features/musteriler/CustomerBadges';
import { isCustomerAnonymized } from '../../features/musteriler/customers';
import { errorMessage } from '../../lib/api';
import type { AdminCustomerListItem } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { cn, formatDateTime } from '../../lib/utils';

const LIMIT_DEFAULT = 25;
type RoleFilter = '' | UserRole;
const ROLE_OPTIONS: ReadonlyArray<{ key: RoleFilter; label: string }> = [
  { key: '', label: 'Tümü' },
  ...USER_ROLE_VALUES.map((r) => ({ key: r as RoleFilter, label: USER_ROLE_LABELS[r] })),
];

/** Ekran 16 — Müşteriler listesi: arama (e-posta/ad/telefon), rol filtresi, son giriş, e-posta doğrulama durumu; detay bağlantısı. */
export function AdminMusterilerListePage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const q = params.get('q') ?? '';
  const role = (params.get('role') ?? '') as RoleFilter;

  const [items, setItems] = useState<AdminCustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await customersApi.list({ page, limit, q: q || undefined, role: role || undefined });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e, 'Müşteriler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, q, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearch = useCallback((v: string) => setParam({ q: v, page: 1 }), [setParam]);

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Müşteriler"
        description="Kayıtlı kullanıcılar (müşteri / personel / yönetici): profil, adres, onaylar ve audit özeti. Sipariş ve abonelik geçmişi F8/F9'da dolar; KVKK anonimleştirme detay sayfasında."
      />

      <AdminToolbar
        className="mb-3"
        searchPlaceholder="E-posta, ad ya da telefon ara…"
        searchValue={q}
        onSearchChange={onSearch}
        filters={<FilterPills options={ROLE_OPTIONS} value={role} onChange={(v) => setParam({ role: v, page: 1 })} label="Rol" />}
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={Users} message={q || role ? 'Filtreye uyan müşteri yok.' : 'Henüz kayıtlı müşteri yok.'} />
      ) : (
        <AdminScrollTable footer={<Pagination total={total} page={page} limit={limit} onPageChange={(p) => setParam({ page: p })} onLimitChange={(l) => setParam({ limit: l, page: 1 })} />}>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Müşteri</th>
                <th className={th}>Telefon</th>
                <th className={th}>Rol</th>
                <th className={th}>Durum</th>
                <th className={th}>E-posta doğrulama</th>
                <th className={th}>Son giriş</th>
                <th className={th}>Kayıt</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const anon = isCustomerAnonymized(c);
                return (
                  <tr key={c.id} className={cn(!c.isActive && 'bg-brand-50/60', anon && 'text-brand-400')}>
                    <td className={tdText}>
                      <Link to={`/musteriler/${c.id}`} className={cn('font-medium hover:text-accent', anon ? 'text-brand-500' : 'text-brand-900')}>
                        {c.email}
                      </Link>
                      {c.name && <span className="block text-xs text-brand-500">{c.name}</span>}
                    </td>
                    <td className={td}>{c.phone ?? <span className="text-brand-400">—</span>}</td>
                    <td className={td}>
                      <RoleBadge role={String(c.role)} />
                    </td>
                    <td className={td}>
                      <CustomerStateBadge customer={c} />
                    </td>
                    <td className={td}>
                      <BoolBadge value={!!c.emailVerifiedAt} yes="Doğrulandı" no="Bekliyor" />
                    </td>
                    <td className={cn(td, 'text-xs')}>{formatDateTime(c.lastLoginAt)}</td>
                    <td className={cn(td, 'text-xs')}>{formatDateTime(c.createdAt)}</td>
                    <td className={td}>
                      <Link to={`/musteriler/${c.id}`} className={btn.icon} aria-label={`${c.email} detay`} title="Detay">
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminScrollTable>
      )}
    </div>
  );
}
