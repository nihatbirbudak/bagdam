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

/**
 * Global hata filtresi — F1 sürümü (SystemLog/Prisma yok; F2'de Prisma hataları,
 * F10'da SystemLog kalıcılığı eklenir).
 *
 * - `/api/*`                → JSON hata zarfı {statusCode, message, error, requestId, timestamp, path}
 * - diğer yollar + 404      → views/404.hbs (text/html, 404)
 * - diğer yollar + 404 dışı → JSON zarfı (500/bakım sayfası F10/F11)
 */

const API_PREFIX = '/api/';

/** Web 404 şablonu (views/404.hbs) */
const NOT_FOUND_VIEW = '404';

export interface ErrorEnvelope {
  statusCode: number;
  message: string | string[];
  error: string;
  requestId: string;
  timestamp: string;
  path: string;
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

/** body-parser hataları (entity.too.large, entity.parse.failed, encoding.unsupported ...) */
function isBodyParserError(exception: unknown): exception is BodyParserError {
  if (!(exception instanceof Error) || !('type' in exception)) return false;
  const type = (exception as BodyParserError).type;
  return typeof type === 'string' && (type.startsWith('entity.') || type.startsWith('encoding.'));
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithMeta>();
    const requestId = request.requestId ?? RequestContext.getRequestId() ?? '-';
    const userId = request.user?.id ?? '-';
    const path = request.originalUrl ?? request.url ?? '-';
    const tag = `[rid:${requestId}] [uid:${userId}] ${request.method} ${path}`;

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

    if (exception instanceof HttpException) {
      // NestJS HTTP hataları (BadRequest, NotFound, Throttler 429, ...)
      status = exception.getStatus();
      error = toErrorName(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        if (typeof b.error === 'string') error = b.error;
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
      this.logger.warn(`BodyParser ${exception.type}: ${exception.message} ${tag}`);
    } else {
      // Bilinmeyen hatalar — güvenli jenerik mesaj, iç bilgi sızdırma
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : String(exception)} ${tag}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // Web (HTML) 404 — /api/* dışındaki bilinmeyen yollar 404.hbs ile döner
    if (status === HttpStatus.NOT_FOUND && !this.isApiPath(path)) {
      this.renderNotFoundPage(response, requestId);
      return;
    }

    const envelope: ErrorEnvelope = {
      statusCode: status,
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
