import { Injectable } from '@nestjs/common';
import { Prisma, type AuditLog, type User, type UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type UserRecord = User;

export interface CustomerFilter {
  q?: string;
  role?: UserRole;
}

export interface CustomerPatchInput {
  isActive?: boolean;
  name?: string;
  phone?: string | null;
  /** isActive=false ile birlikte oturumları düşürmek için. */
  refreshTokenHash?: null;
}

export interface AnonymizeInput {
  email: string;
  passwordHash: string;
  anonymizedAt: Date;
}

/** Müşteri detayı audit özeti: son N satır (aktör = kullanıcı ya da entityId = kullanıcı). */
export const CUSTOMER_AUDIT_LIMIT = 20;

/**
 * CustomersRepository — User tablosu admin okuma/yazma + KVKK anonimleştirme işlemi; Prisma YALNIZ burada (ADR-0002).
 * Silinmiş (deletedAt) kullanıcılar listelenmez. Zaman parametreyle gelir (ADR-0004).
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: CustomerFilter, skip: number, take: number): Promise<{ rows: UserRecord[]; total: number }> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.q
        ? {
            OR: [
              { email: { contains: filter.q, mode: 'insensitive' } },
              { name: { contains: filter.q, mode: 'insensitive' } },
              { phone: { contains: filter.q } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.user.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  update(id: string, data: CustomerPatchInput): Promise<UserRecord> {
    return this.prisma.user.update({ where: { id }, data });
  }

  /** Son audit satırları: kullanıcının yaptıkları (actorId) ya da kullanıcı üzerinde yapılanlar (entityId). */
  findAuditSummary(userId: string, take: number = CUSTOMER_AUDIT_LIMIT): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { OR: [{ actorId: userId }, { entityId: userId }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  /**
   * KVKK anonimleştirme — tek işlem: e-posta `anon+<id>@anon.local`, ad/telefon/prefs/reset alanları sıfır,
   * parola rastgele hash, refresh hash null (oturumlar düşer), isActive false, anonymizedAt; adres satırları SİLİNİR
   * (PII; F7 Subscription FK'si geldiğinde veri saklama matrisi ADR'ı — F10 — yeniden ele alır).
   */
  async anonymize(id: string, input: AnonymizeInput): Promise<UserRecord> {
    const [, user] = await this.prisma.$transaction([
      this.prisma.address.deleteMany({ where: { userId: id } }),
      this.prisma.user.update({
        where: { id },
        data: {
          email: input.email,
          name: null,
          phone: null,
          passwordHash: input.passwordHash,
          refreshTokenHash: null,
          passwordResetToken: null,
          passwordResetExpires: null,
          prefs: Prisma.DbNull,
          marketingOptIn: false,
          isActive: false,
          anonymizedAt: input.anonymizedAt,
        },
      }),
    ]);
    return user;
  }
}
