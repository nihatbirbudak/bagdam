import { Matches } from 'class-validator';
import { LINK_TOKEN_RE } from '../payments.constants';

/** `GET /pay/:linkToken` — 32 hex (16 rastgele bayt). Biçimsiz token 400 (DB'ye gidilmez). */
export class LinkTokenParamDto {
  @Matches(LINK_TOKEN_RE, { message: 'linkToken geçersiz' })
  linkToken!: string;
}
