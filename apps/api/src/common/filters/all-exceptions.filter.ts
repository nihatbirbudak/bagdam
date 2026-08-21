import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_VERSION } from '../../config/app-info';
import { RequestContext } from '../request-context';
import { redactUrl } from '../security/redaction';

/**
 * Global hata filtresi.
 *
 * - `/api/*`                → JSON hata zarfı {statusCode, code, message, error, requestId, timestamp, path}
 * - diğer yollar + 404      → views/404.hbs (text/html, 404)
 * - diğer yollar + 404 dışı → JSON zarfı
 *
 * F10 eklemeleri:
 *  - `code` alanı: makine tarafından ayrıştırılabilir sabit kod (F8 açık notu). `error` alanı eski
 *    istemciler için olduğu gibi bırakıldı; `code` her zaman `[A-Z][A-Z0-9_]*` biçimindedir.
 *  - Log satırlarındaki yol `redactUrl` ile maskelenir (`?token=…`, `?to=e-posta` PM2 loguna düşmesin).
 *  - 5xx hataları isteğe bağlı `SystemLogSink` ile `system_logs` tablosuna yazılır (ekran 22).
 */

const API_PREFIX = '/api/';

/** Web 404 şablonu (views/404.hbs) */
const NOT_FOUND_VIEW = '404';

/** `code` alanına yazılabilecek biçim: BÜYÜK_HARF_ALT_ÇİZGİ. */
const MACHINE_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

export interface ErrorEnvelope {
  statusCode: number;
  /** Makine kodu — istemci bu alana göre dallanır (ör. `CSRF_INVALID`, `NOT_FOUND`, `DAY_FULL`). */
  code: string;
  message: string | string[];
  error: string;
  requestId: string;
  timestamp: string;
  path: string;
}

/**
 * 5xx hatalarının kalıcılaştırılması (modules/system-logs). Filtre bootstrap'ta `new` ile örneklenir
 * (DI yok) → bağımlılık isteğe bağlı geçilir; verilmezse yalnız Logger'a yazılır.
 */
export interface SystemLogSink {
  recordError(input: {
    level: 'error' | 'fatal' | 'warn';
    module: string;
    action?: string | null;
    message: string;
    requestId?: string | null;
    userId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): void;
}

interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

type RequestWithMeta = Request & { requestId?: string; user?: { id?: string } };

/** HttpStatus enum adını okunur hale getirir: NOT_FOUND → "Not Found" */
function toErrorName(status: number): string {
  const key = HttpStatus[status];
  if (!key) return 'Error';
  return key
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

/** Durum kodundan makine kodu: 404 → NOT_FOUND, 500 → INTERNAL_SERVER_ERROR. */
function toStatusCodeName(status: number): string {
  const key = HttpStatus[status];
  return typeof key === 'string' && key.length > 0 ? key : `HTTP_${status}`;
}

/** body-parser hataları (entity.too.large, entity.parse.failed, encoding.unsupported ...) */
function isBodyParserError(exception: unknown): exception is BodyParserError {
  if (!(exception instanceof Error) || !('type' in exception)) return false;
  const type = (exception as BodyParserError).type;
  return typeof type === 'string' && (type.startsWith('entity.') || type.startsWith('encoding.'));
}

/** Yığın izinin ilk satırları (SystemLog metadata'sı; yanıta ASLA yazılmaz). */
function shortStack(exception: unknown): string | null {
  if (!(exception instanceof Error) || !exception.stack) return null;
  return exception.stack.split('\n').slice(0, 5).join('\n');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /** `sink`: main.ts'te SystemLogsService geçilir; test harness'lerinde boş bırakılır. */
  constructor(private readonly sink?: SystemLogSink) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithMeta>();
    const requestId = request.requestId ?? RequestContext.getRequestId() ?? '-';
    const userId = request.user?.id ?? '-';
    const path = request.originalUrl ?? request.url ?? '-';
    const safePath = redactUrl(path);
    const tag = `[rid:${requestId}] [uid:${userId}] ${request.method} ${safePath}`;

    // Yanıt zaten gönderildiyse (render callback'i vb.) tekrar gönderme
    if (response.headersSent) {
      this.logger.warn(
        `Exception after response sent: ${exception instanceof Error ? exception.message : String(exception)} ${tag}`,
      );
      return;
    }

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Sunucu hatası oluştu';
    let error = toErrorName(status);
    let code = toStatusCodeName(status);

    if (exception instanceof HttpException) {
      // NestJS HTTP hataları (BadRequest, NotFound, Throttler 429, ...)
      status = exception.getStatus();
      error = toErrorName(status);
      code = toStatusCodeName(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string; code?: string };
        message = b.message ?? exception.message;
        if (typeof b.error === 'string') error = b.error;
        // Uygulama kodu (`{error:'CSRF_INVALID'}` ya da açıkça `{code:'DAY_FULL'}`) varsa onu kullan.
        const explicit = [b.code, b.error].find(
          (c): c is string => typeof c === 'string' && MACHINE_CODE_RE.test(c),
        );
        if (explicit) code = explicit;
      }

      if (status >= 500) {
        this.logger.error(`HTTP ${status}: ${JSON.stringify(body)} ${tag}`, exception.stack);
      } else if (status === HttpStatus.NOT_FOUND) {
        // 404 gürültüsü (bot taramaları) — warn değil log
        this.logger.log(`HTTP 404 ${tag}`);
      } else {
        this.logger.warn(`HTTP ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)} ${tag}`);
      }
    } else if (isBodyParserError(exception)) {
      status = exception.status ?? exception.statusCode ?? HttpStatus.BAD_REQUEST;
      message =
        status === HttpStatus.PAYLOAD_TOO_LARGE ? 'İstek gövdesi çok büyük' : 'Geçersiz istek gövdesi';
      error = toErrorName(status);
      code = status === HttpStatus.PAYLOAD_TOO_LARGE ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST_BODY';
      this.logger.warn(`BodyParser ${exception.type}: ${exception.message} ${tag}`);
    } else {
      // Bilinmeyen hatalar — güvenli jenerik mesaj, iç bilgi sızdırma
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : String(exception)} ${tag}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // 5xx → system_logs (parmak izi ile tekilleştirilir; ekran 22 › Sistem günlüğü)
    if (status >= 500) {
      this.sink?.recordError({
        level: 'error',
        module: 'http',
        action: request.method,
        message: exception instanceof Error ? exception.message : String(exception),
        requestId: request.requestId ?? null,
        userId: request.user?.id ?? null,
        metadata: { status, path: safePath, stack: shortStack(exception) },
      });
    }

    // Web (HTML) 404 — /api/* dışındaki bilinmeyen yollar 404.hbs ile döner
    if (status === HttpStatus.NOT_FOUND && !this.isApiPath(path)) {
      this.renderNotFoundPage(response, requestId);
      return;
    }

    const envelope: ErrorEnvelope = {
      statusCode: status,
      code,
      message,
      error,
      requestId,
      timestamp: new Date().toISOString(),
      path,
    };
    response.status(status).json(envelope);
  }

  private isApiPath(path: string): boolean {
    return path.startsWith(API_PREFIX) || path === API_PREFIX.slice(0, -1);
  }

  /** views/404.hbs → text/html 404. Şablon render edilemezse düz metin 404. */
  private renderNotFoundPage(response: Response, requestId: string): void {
    response.status(HttpStatus.NOT_FOUND);
    response.setHeader('Cache-Control', 'private, no-store');
    response.render(NOT_FOUND_VIEW, { assetVersion: APP_VERSION, requestId }, (err, html) => {
      if (err) {
        this.logger.error(`404 şablonu render edilemedi: ${err.message}`, err.stack);
        response.type('text/plain; charset=utf-8').send('404 — Sayfa bulunamadı');
        return;
      }
      response.type('html').send(html);
    });
  }
}
