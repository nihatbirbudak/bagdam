/**
 * Sistem günlükleri + sağlık admin uçları (ekran 22).
 *   F6:  `GET /admin/mail-logs`
 *   F10: `GET /admin/system-logs` · `GET /admin/cron-logs` · `GET /admin/webhook-events`
 *        `GET /admin/audit-logs` · `GET /admin/health/detailed` · `GET|POST /admin/jobs`
 * Yalnız ince istemci: filtreleme/sayfalama sunucuda, panel gösterir.
 */
import { api, buildQuery } from '../../lib/api';
import type {
  AdminAuditLog,
} from '../../lib/adminTypes';
import type {
  AdminAuditLogQuery,
  AdminHealthDetailed,
  AdminMailLog,
  AdminMailLogQuery,
  CronLogItem,
  CronLogListQuery,
  JobInfo,
  JobRunResult,
  Paginated,
  SystemLogItem,
  SystemLogListQuery,
  WebhookEventItem,
  WebhookEventListQuery,
} from '../../lib/apiTypes';
import { unwrapPage } from '../icerik/api';
import { normalizeMailLog } from './mailLogs';

export const mailLogsApi = {
  list: async (params: AdminMailLogQuery): Promise<{ items: AdminMailLog[]; total: number }> => {
    const page = unwrapPage<unknown>(await api.get<unknown>(`/admin/mail-logs${buildQuery(params)}`));
    return { items: page.items.map(normalizeMailLog).filter((m): m is AdminMailLog => !!m), total: page.total };
  },
};

export const auditLogsApi = {
  list: (params: AdminAuditLogQuery): Promise<Paginated<AdminAuditLog>> =>
    api.get<Paginated<AdminAuditLog>>(`/admin/audit-logs${buildQuery(params)}`),
};

export const systemLogsApi = {
  list: (params: SystemLogListQuery): Promise<Paginated<SystemLogItem>> =>
    api.get<Paginated<SystemLogItem>>(`/admin/system-logs${buildQuery(params)}`),
};

export const cronLogsApi = {
  list: (params: CronLogListQuery): Promise<Paginated<CronLogItem>> =>
    api.get<Paginated<CronLogItem>>(`/admin/cron-logs${buildQuery(params)}`),
};

export const webhookEventsApi = {
  list: (params: WebhookEventListQuery): Promise<Paginated<WebhookEventItem>> =>
    api.get<Paginated<WebhookEventItem>>(`/admin/webhook-events${buildQuery(params)}`),
};

export const systemHealthApi = {
  detailed: (): Promise<AdminHealthDetailed> => api.get<AdminHealthDetailed>('/admin/health/detailed'),
};

export const jobsApi = {
  /** Kayıt defteri + cron ifadesi + son koşu. Yalnız ADMIN; STAFF 403 alır (panel sessizce gizler). */
  list: (): Promise<JobInfo[]> => api.get<JobInfo[]>('/admin/jobs'),
  /** Elle tetikleme — üretimde gösterilmez (`AdminHealthDetailed.jobRunAllowed`). */
  run: (name: string): Promise<JobRunResult> => api.post<JobRunResult>(`/admin/jobs/${encodeURIComponent(name)}/run`),
};
