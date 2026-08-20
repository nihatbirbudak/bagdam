import { Injectable, Logger } from '@nestjs/common';

/** PayTR HTTP istemcisi DI anahtarı — testler `overrideProvider(PAYTR_HTTP).useValue(mock)` ile ezer (gerçek PayTR'ye istek ATILMAZ). */
export const PAYTR_HTTP = Symbol('PAYTR_HTTP');

/** Tek istek zaman aşımı (ms) — PayTR yavaşlarsa çağıran asılı kalmasın (UA kalıbı 15 s). */
export const PAYTR_HTTP_TIMEOUT_MS = 15_000;

export interface PayTrHttpResponse {
  status: number;
  /** Ham gövde (JSON bekleriz; bozuksa çağıran `parseJsonBody` ile null alır). */
  body: string;
}

/** PayTR uçları form-urlencoded POST alır, JSON döner. */
export interface PayTrHttp {
  postForm(url: string, form: Record<string, string>, opts?: { timeoutMs?: number }): Promise<PayTrHttpResponse>;
}

/** Gövdeyi JSON olarak ayrıştırır; bozuksa null (çağıran `PAYTR_BAD_RESPONSE` üretir). */
export function parseJsonBody<T>(res: PayTrHttpResponse): T | null {
  if (!res.body) return null;
  try {
    const parsed = JSON.parse(res.body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** Varsayılan uygulama — Node 20 global `fetch` (ek bağımlılık yok). */
@Injectable()
export class FetchPayTrHttp implements PayTrHttp {
  private readonly logger = new Logger(FetchPayTrHttp.name);

  async postForm(url: string, form: Record<string, string>, opts: { timeoutMs?: number } = {}): Promise<PayTrHttpResponse> {
    const body = new URLSearchParams(form);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? PAYTR_HTTP_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) this.logger.warn(`PayTR ${url} → HTTP ${res.status}`);
    return { status: res.status, body: text };
  }
}
