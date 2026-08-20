import { SetMetadata } from '@nestjs/common';

/**
 * CsrfGuard'ı bu handler/sınıf için atla. Yalnız çerezle kimlik taşımayan ya da çerezi kendisi üreten uçlar:
 * login, csrf, refresh, ödeme webhook/callback. Admin mutasyonlarında ASLA kullanılmaz (ADR-0009/0015).
 */
export const SKIP_CSRF_KEY = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
