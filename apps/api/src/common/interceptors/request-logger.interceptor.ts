import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { redactUrl } from '../security/redaction';

type RequestWithMeta = Request & { requestId?: string; user?: { id?: string } };

/**
 * Tüm HTTP isteklerini yapılandırılmış biçimde loglar (2xx/3xx).
 * 4xx/5xx AllExceptionsFilter'da loglanır — burada tekrar edilmez.
 * Not: @Res() ile render eden web sayfalarında handler dönüşü anında loglanır
 * (render async; status o anda 200'dür).
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithMeta>();
    const { method } = req;
    // ADR-0015 (F10): sorgu dizesindeki token/e-posta değerleri loga ham düşmesin.
    const originalUrl = redactUrl(req.originalUrl);
    const requestId = req.requestId ?? '-';
    const userId = req.user?.id ?? '-';
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const ms = Date.now() - start;
          const status = res.statusCode;
          if (status < 400) {
            this.logger.log(`${method} ${originalUrl} ${status} ${ms}ms [rid:${requestId}] [uid:${userId}]`);
          }
        },
        error: () => {
          // Hata loglama AllExceptionsFilter'da (requestId ile) — burada duplicate etmiyoruz
        },
      }),
    );
  }
}
