import { IsDefined, IsObject } from 'class-validator';

/**
 * `PUT /admin/site-content/:key` — `{ value: {...} }`. İç alanlar burada değil, ContentAdminService'te şemaya göre
 * doğrulanır (site-content.schema#validateContentValue: bilinmeyen alan / zorunlu eksik / tip → 400).
 */
export class UpdateSiteContentDto {
  @IsDefined({ message: 'value gerekli' })
  @IsObject({ message: 'value nesne olmalı' })
  value!: Record<string, unknown>;
}
