import { IsOptional, Matches } from 'class-validator';

/** `GET /tiers/:slug/template?week=YYYY-MM-DD` — haftanın herhangi bir günü; Pazartesi'ye yuvarlanır. Yoksa bu hafta. */
export class TemplateQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'week YYYY-MM-DD biçiminde olmalı' })
  week?: string;
}
