import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
  RequestTimeoutException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { SKIP_TIMEOUT_KEY } from '../decorators/skip-timeout.decorator';

export const TIMEOUT_MS = 'TIMEOUT_MS';

/**
 * İstek zaman aşımı (varsayılan 30 sn). @SkipTimeout() ile handler/sınıf bazında atlanır
 * (web sayfaları, uzun süren admin dışa aktarımları vb.).
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly ms: number;

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(TIMEOUT_MS) ms?: number,
  ) {
    this.ms = ms ?? 30_000;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(
      timeout(this.ms),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(() => new RequestTimeoutException('İstek zaman aşımına uğradı'));
        }
        return throwError(() => err);
      }),
    );
  }
}
