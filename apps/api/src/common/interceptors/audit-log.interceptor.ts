import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';
import { AUDIT_MODULE_KEY, getAuditValues } from '../decorators/audit.decorator';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';
import { redactObject } from '../security/redaction';

/** Yalnız mutasyonlar loglanır (GET/HEAD/OPTIONS yok). */
const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** HTTP metodu → eylem (handler adından daha özel bir fiil çıkmazsa). */
const METHOD_ACTIONS: Record<string, string> = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

/** Handler adının ilk fiili bu listedeyse eylem olarak kullanılır (ör. `publishTemplate` → PUBLISH). */
const VERB_ACTIONS: Record<string, string> = {
  create: 'CREATE',
  add: 'CREATE',
  upload: 'UPLOAD',
  import: 'IMPORT',
  register: 'CREATE',
  update: 'UPDATE',
  patch: 'UPDATE',
  edit: 'UPDATE',
  set: 'UPDATE',
  change: 'UPDATE',
  toggle: 'UPDATE',
  assign: 'UPDATE',
  reorder: 'REORDER',
  publish: 'PUBLISH',
  unpublish: 'UNPUBLISH',
  clone: 'CLONE',
  delete: 'DELETE',
  remove: 'DELETE',
  restore: 'RESTORE',
  anonymize: 'ANONYMIZE',
  refund: 'REFUND',
  charge: 'CHARGE',
  cancel: 'CANCEL',
  login: 'LOGIN',
  logout: 'LOGOUT',
};

/**
 * Redaksiyon (ADR-0015) — anahtar listeleri ve derin redaksiyon `common/security/redaction.ts` dosyasında
 * (audit, HTTP log ve admin webhook payload'ı aynı kaynağı kullanır). Aşağıdaki iki dışa aktarım
 * mevcut çağıranlar/testler kırılmasın diye korunan takma adlardır.
 */
export { REDACTED } from '../security/redaction';

/** Audit anlık görüntüsü için derin redaksiyon (bkz. `redactObject`). */
export function redactForAudit(value: unknown, depth = 0): unknown {
  return redactObject(value, depth);
}

function resolveAction(method: string, handlerName: string): string {
  const verb = /^[a-z]+/.exec(handlerName)?.[0] ?? '';
  return VERB_ACTIONS[verb] ?? METHOD_ACTIONS[method] ?? method;
}

function pickString(obj: unknown, keys: readonly string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function buildSummary(moduleName: string, action: string, label: string | undefined, entityId: string | undefined): string {
  const subject = label ? `«${label}»` : entityId ? `#${entityId}` : '';
  return `${moduleName}: ${action}${subject ? ` ${subject}` : ''}`;
}

/**
 * AuditLogInterceptor (ADR-0015) — `@Audited(module)` işaretli handler/sınıflarda başarılı POST/PUT/PATCH/DELETE
 * sonrası AuditLog satırı yazar (APP_INTERCEPTOR, AppModule):
 *  - actor: req.user (JwtAuthGuard; login handler'ı da başarılı girişte set eder)
 *  - action: handler adındaki fiil (publish/reorder/login…) ya da HTTP metodu → CREATE/UPDATE/DELETE
 *  - entityId: setAuditValues ipucu → `:id` param → yanıttaki `id`
 *  - newValues: ipucu ya da redakte edilmiş gövde (DELETE'te yok); oldValues yalnız ipucu ile
 *  - e-posta/telefon/adres/parola alanları `[redacted]`
 * Yazma yanıt akışında beklenir (birkaç ms) ama hata üretmez (AuditService.record yutar). Başarısız istekler loglanmaz.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const moduleName = this.reflector.getAllAndOverride<string | undefined>(AUDIT_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleName) return next.handle();

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const method = (req.method ?? '').toUpperCase();
    if (!AUDITED_METHODS.has(method)) return next.handle();

    const action = resolveAction(method, context.getHandler().name);
    const paramId = typeof req.params?.id === 'string' ? req.params.id : undefined;
    const bodySnapshot = method === 'DELETE' ? undefined : redactForAudit(req.body);

    return next.handle().pipe(
      mergeMap(async (response: unknown) => {
        const hints = getAuditValues(req);
        const entityId = hints?.entityId ?? paramId ?? pickString(response, ['id']);
        const label = hints?.label ?? pickString(response, ['name', 'label', 'slug', 'title', 'lotCode', 'originalName']);
        await this.audit.record({
          actorId: req.user?.id ?? null,
          actorEmail: req.user?.email ?? null,
          action,
          module: moduleName,
          entityId: entityId ?? null,
          summary: buildSummary(moduleName, action, label, entityId),
          oldValues: hints?.oldValues !== undefined ? redactForAudit(hints.oldValues) : undefined,
          newValues: hints?.newValues !== undefined ? redactForAudit(hints.newValues) : bodySnapshot,
          requestId: req.requestId ?? null,
          ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
        });
        return response;
      }),
    );
  }
}
