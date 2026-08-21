/**
 * Özet (ekran 21) veri erişimi — `GET /api/v1/admin/dashboard` (F9/C, DashboardModule).
 * Salt okuma; tüm metrikler sunucuda türetilir (sipariş/ciro, abonelik sayaçları, kesim durumu,
 * ödeme problemleri, son abonelik olayları). Panel yalnız gösterir.
 */
import { api } from '../../lib/api';
import type { AdminDashboard } from '../../lib/apiTypes';

export const dashboardApi = {
  summary: (): Promise<AdminDashboard> => api.get<AdminDashboard>('/admin/dashboard'),
};
