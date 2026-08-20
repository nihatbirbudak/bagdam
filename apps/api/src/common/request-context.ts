/**
 * RequestContext — AsyncLocalStorage ile requestId/traceId her async call'da erişilebilir.
 *
 * Problem: NestJS'te requestId sadece HTTP request scope'unda mevcut.
 * Cron job, fire-and-forget mail, ödeme callback'i gibi async zincirlerde kaybolur.
 *
 * Çözüm: Node.js AsyncLocalStorage → tüm async çağrı zincirinde context taşır.
 *
 * Kullanım (service içinde):
 *   import { RequestContext } from '../common/request-context';
 *   const rid = RequestContext.getRequestId();   // undefined olabilir
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextData {
  requestId: string;
  /** Kullanıcı ID — JWT'den set edilir (F4/F6) */
  userId?: string;
  actorType?: 'user' | 'admin' | 'system' | 'guest';
  /** Ek etiket: 'http', 'cron', 'webhook', 'scheduled' */
  source?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  /**
   * Context başlat — middleware veya cron giriş noktasında çağrılır.
   * Verilen callback ve onun tetiklediği tüm async zincir context'i taşır.
   */
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  /** Mevcut context'i döndür (yoksa undefined) */
  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  /** RequestId kısayolu */
  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  /** UserId kısayolu */
  getUserId(): string | undefined {
    return storage.getStore()?.userId;
  },
};
