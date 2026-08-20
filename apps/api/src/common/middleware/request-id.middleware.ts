import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../request-context';

/** Gelen X-Request-Id yalnız güvenli karakterlerden oluşuyorsa kabul edilir (log/header enjeksiyonu önlemi). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Her HTTP isteğine benzersiz requestId atar.
 * Gelen X-Request-Id header'ı (nginx $request_id) geçerliyse kullanır, yoksa üretir.
 * Response header'a da yazar → nginx/istemci korelasyonu sağlar.
 *
 * AsyncLocalStorage aracılığıyla requestId'yi tüm async zincire taşır;
 * cron/fire-and-forget servisleri RequestContext.getRequestId() ile erişebilir.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();

    (req as Request & { requestId?: string }).requestId = id;
    res.setHeader('X-Request-Id', id);

    // AsyncLocalStorage context başlat — tüm downstream async çağrılar bu context'i taşır
    RequestContext.run({ requestId: id, source: 'http' }, () => next());
  }
}
