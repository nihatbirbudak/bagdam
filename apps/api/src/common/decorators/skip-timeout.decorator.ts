import { SetMetadata } from '@nestjs/common';

/** TimeoutInterceptor'ı bu handler/sınıf için atla. */
export const SKIP_TIMEOUT_KEY = 'skipTimeout';
export const SkipTimeout = () => SetMetadata(SKIP_TIMEOUT_KEY, true);
