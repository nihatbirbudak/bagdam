/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API tabanı (varsayılan `/api/v1`; same-origin). */
  readonly VITE_API_URL?: string;
  /** F1 geçici kapı: "true" iken route guard atlanır (yalnız dev sunucusunda etkili). */
  readonly VITE_AUTH_DISABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
