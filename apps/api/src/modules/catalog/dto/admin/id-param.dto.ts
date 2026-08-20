import { Matches } from 'class-validator';
import { ID_RE } from './transforms';

/** `:id` yol parametresi (cuid). */
export class IdParamDto {
  @Matches(ID_RE, { message: 'id geçersiz' })
  id!: string;
}

/** `:id/lots/:lotId` */
export class LotParamsDto extends IdParamDto {
  @Matches(ID_RE, { message: 'lotId geçersiz' })
  lotId!: string;
}

/** `:id/images/:imageId` */
export class ImageParamsDto extends IdParamDto {
  @Matches(ID_RE, { message: 'imageId geçersiz' })
  imageId!: string;
}
