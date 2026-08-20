import { JOB_NAME_VALUES, type JobName } from '@bagdam/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/** `:name` yol parametresi — yalnız kayıtlı job adları. */
export class JobNameParamDto {
  @IsIn(JOB_NAME_VALUES)
  name!: JobName;
}

/** `GET /admin/jobs/runs?name=&limit=`. */
export class JobRunsQueryDto {
  @IsOptional()
  @IsIn(JOB_NAME_VALUES)
  name?: JobName;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * `POST /admin/jobs/:name/run` gövdesi — `now`: job'ın 'şimdi' kabul edeceği an (ISO 8601). Yalnız e2e/test ve geliştirme
 * (NODE_ENV !== production ya da ALLOW_JOB_TIME_OVERRIDE=true); üretimde 403 JOB_NOW_OVERRIDE_FORBIDDEN.
 */
export class JobRunBodyDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  now?: string;
}
