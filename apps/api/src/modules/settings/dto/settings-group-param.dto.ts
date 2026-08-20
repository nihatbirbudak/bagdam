import { Matches } from 'class-validator';

/** `:group` yol parametresi — yalnız güvenli karakterler; bilinmeyen grup serviste 404. */
export class SettingsGroupParamDto {
  @Matches(/^[a-z][a-z0-9_-]{0,39}$/, { message: 'group geçersiz' })
  group!: string;
}
