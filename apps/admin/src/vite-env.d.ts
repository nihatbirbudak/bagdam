/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API tabanı (varsayılan `/api/v1`; same-origin). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
