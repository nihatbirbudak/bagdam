import { IsBoolean, IsIn } from 'class-validator';

/** `POST /me/consents` ile değiştirilebilen türler — pazarlama izinleri (İYS: iysStatus PENDING). KVKK/sözleşme onayları buradan değişmez. */
export const ME_CONSENT_KINDS = ['MARKETING_EMAIL', 'MARKETING_SMS'] as const;
export type MeConsentKind = (typeof ME_CONSENT_KINDS)[number];

/** `POST /me/consents {kind, granted}` → 201 {kind, granted, createdAt}. */
export class MeConsentDto {
  @IsIn(ME_CONSENT_KINDS, { message: 'kind MARKETING_EMAIL | MARKETING_SMS olmalı' })
  kind!: MeConsentKind;

  @IsBoolean({ message: 'granted true/false olmalı' })
  granted!: boolean;
}
