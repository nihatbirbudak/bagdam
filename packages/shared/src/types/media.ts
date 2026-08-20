// ── Medya DTO'ları ───────────────────────────────────────────────────────────
import type { Id, IsoDateTime } from './common';

/** MediaFile — mevcut 58 görsel `media:import` ile orijinal yolundan (yeniden kodlanmadan) alınır [B22]. */
export interface MediaFile {
  id: Id;
  /** Genel yol: `/uploads/<klasör>/<dosya>` ya da import edilen `assets/images/...`. */
  path: string;
  thumbPath: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  folder: string;
  createdAt: IsoDateTime;
}

export interface MediaFilePatch {
  alt?: string | null;
  folder?: string;
}

export interface MediaListQuery {
  folder?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}
