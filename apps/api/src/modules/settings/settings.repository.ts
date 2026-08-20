import { Injectable } from '@nestjs/common';
import type { Prisma, Setting } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type SettingRecord = Setting;

/** Upsert girdisi — `value` JSON'a yazılabilir (sırlar çağıran tarafından ŞİFRELENMİŞ olarak gelir). */
export interface SettingUpsertInput {
  key: string;
  group: string;
  value: Prisma.InputJsonValue;
  isSecret: boolean;
}

/**
 * SettingsRepository — Setting tablosu; Prisma YALNIZ burada (ADR-0002). Şifreleme/maskeleme/doğrulama
 * SettingsService'te; burada yalnız okuma/yazma. Zaman: ham SQL yok (ADR-0004).
 */
@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<SettingRecord[]> {
    return this.prisma.setting.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
  }

  findByGroup(group: string): Promise<SettingRecord[]> {
    return this.prisma.setting.findMany({ where: { group }, orderBy: { key: 'asc' } });
  }

  findByKey(key: string): Promise<SettingRecord | null> {
    return this.prisma.setting.findUnique({ where: { key } });
  }

  /** Tek işlemde upsert — ya hepsi ya hiçbiri. */
  async upsertMany(rows: readonly SettingUpsertInput[]): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.setting.upsert({
          where: { key: r.key },
          create: { key: r.key, group: r.group, value: r.value, isSecret: r.isSecret },
          update: { group: r.group, value: r.value, isSecret: r.isSecret },
        }),
      ),
    );
  }
}
