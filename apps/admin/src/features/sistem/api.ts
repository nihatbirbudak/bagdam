/** Sistem günlükleri admin uçları — F6: `GET /admin/mail-logs` (MailLog). Yalnız ince istemci. */
import { api, buildQuery } from '../../lib/api';
import type { AdminMailLog, AdminMailLogQuery } from '../../lib/apiTypes';
import { unwrapPage } from '../icerik/api';
import { normalizeMailLog } from './mailLogs';

export const mailLogsApi = {
  list: async (params: AdminMailLogQuery): Promise<{ items: AdminMailLog[]; total: number }> => {
    const page = unwrapPage<unknown>(await api.get<unknown>(`/admin/mail-logs${buildQuery(params)}`));
    return { items: page.items.map(normalizeMailLog).filter((m): m is AdminMailLog => !!m), total: page.total };
  },
};
