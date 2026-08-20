import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** JwtAuthGuard'ın her istekte okuduğu dar projeksiyon. */
export const SESSION_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  deletedAt: true,
} as const satisfies Prisma.UserSelect;

export type SessionUserRow = Prisma.UserGetPayload<{ select: typeof SESSION_USER_SELECT }>;

/** `GET /auth/me` projeksiyonu. */
export const ME_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
  deletedAt: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

export type MeRow = Prisma.UserGetPayload<{ select: typeof ME_SELECT }>;

/**
 * AuthRepository — User tablosu erişimi (Prisma yalnız burada, ADR-0002).
 * Kurallar (kilit, rotasyon) AuthService'te; burada yalnız sorgular.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** citext e-posta: büyük/küçük harf duyarsız benzersiz; silinmiş kullanıcı da döner (servis ayırır). */
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findSessionUser(id: string): Promise<SessionUserRow | null> {
    return this.prisma.user.findUnique({ where: { id }, select: SESSION_USER_SELECT });
  }

  findMe(id: string): Promise<MeRow | null> {
    return this.prisma.user.findUnique({ where: { id }, select: ME_SELECT });
  }

  /** Hatalı giriş: sayaç artar; eşik aşıldıysa kilit tarihi yazılır ve sayaç sıfırlanır. */
  recordFailedLogin(id: string, failedLoginAttempts: number, lockedUntil: Date | null): Promise<void> {
    return this.prisma.user
      .update({ where: { id }, data: { failedLoginAttempts, lockedUntil } })
      .then(() => undefined);
  }

  /** Başarılı giriş: sayaç/kilit sıfır, lastLoginAt, yeni refresh hash'i. */
  recordLoginSuccess(id: string, refreshTokenHash: string, now: Date): Promise<void> {
    return this.prisma.user
      .update({
        where: { id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now, refreshTokenHash },
      })
      .then(() => undefined);
  }

  /**
   * Refresh rotasyonu — karşılaştır-ve-yaz: yalnız DB'deki hash hâlâ `currentHash` ise yeni hash yazılır.
   * Eşzamanlı iki yenilemeden yalnız biri başarılı olur (ikincisi false → 401).
   */
  async rotateRefreshTokenHash(id: string, currentHash: string, nextHash: string): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id, refreshTokenHash: currentHash },
      data: { refreshTokenHash: nextHash },
    });
    return result.count === 1;
  }

  setRefreshTokenHash(id: string, refreshTokenHash: string | null): Promise<void> {
    return this.prisma.user.update({ where: { id }, data: { refreshTokenHash } }).then(() => undefined);
  }

  updateProfile(id: string, data: { name?: string; phone?: string | null }): Promise<MeRow> {
    return this.prisma.user.update({ where: { id }, data, select: ME_SELECT });
  }

  /** Parola değişimi: yeni hash + yeni refresh hash (eski refresh çerezleri geçersizleşir). */
  updatePassword(id: string, passwordHash: string, refreshTokenHash: string): Promise<void> {
    return this.prisma.user
      .update({ where: { id }, data: { passwordHash, refreshTokenHash } })
      .then(() => undefined);
  }

  // ── F6: kayıt · e-posta doğrulama · parola sıfırlama ────────────────────────

  /**
   * Müşteri kaydı + onay satırları TEK işlemde (iç içe create): kullanıcı var ama KVKK onayı yok durumu oluşmaz.
   * `consents` Consent.user ilişkisi üzerinden (userId otomatik); documentId önceden çözülmüş (ContentService).
   */
  createCustomer(data: CustomerCreateInput, consents: CustomerConsentInput[]): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        phone: data.phone,
        role: 'CUSTOMER',
        marketingOptIn: data.marketingOptIn,
        consents: { create: consents },
      },
    });
  }

  /** Doğrulama: ilk kez ise emailVerifiedAt yazılır; zaten doğruysa dokunulmaz (idempotent). */
  markEmailVerified(id: string, at: Date): Promise<boolean> {
    return this.prisma.user
      .updateMany({ where: { id, emailVerifiedAt: null, deletedAt: null }, data: { emailVerifiedAt: at } })
      .then((r) => r.count === 1);
  }

  /** Parola sıfırlama: token'ın sha256 özeti + son kullanma; önceki token geçersizleşir. */
  setPasswordResetToken(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    return this.prisma.user
      .update({ where: { id }, data: { passwordResetToken: tokenHash, passwordResetExpires: expiresAt } })
      .then(() => undefined);
  }

  /** Özet ile kullanıcı (süre kontrolü serviste — geçersiz/süresi dolmuş ayrımı tek mesajla döner). */
  findByPasswordResetTokenHash(tokenHash: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { passwordResetToken: tokenHash } });
  }

  /**
   * Sıfırlama tamamlandı: yeni parola, token temizlenir, refresh hash = yeni oturumunki (diğer oturumlar düşer),
   * kilit/sayaç sıfır (parolasını sıfırlayan kullanıcı kilitli kalmasın). Karşılaştır-ve-yaz: token hâlâ aynıysa
   * (eşzamanlı ikinci deneme yapılmamışsa) — count 0 → çağıran RESET_TOKEN_INVALID verir.
   */
  completePasswordReset(id: string, tokenHash: string, passwordHash: string, refreshTokenHash: string, now: Date): Promise<boolean> {
    return this.prisma.user
      .updateMany({
        where: { id, passwordResetToken: tokenHash },
        data: {
          passwordHash,
          passwordResetToken: null,
          passwordResetExpires: null,
          refreshTokenHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: now,
        },
      })
      .then((r) => r.count === 1);
  }
}

export interface CustomerCreateInput {
  email: string;
  passwordHash: string;
  name: string | null;
  phone: string | null;
  marketingOptIn: boolean;
}

/** Kayıt onayı — Prisma iç içe create girdisi (userId ilişkiden gelir; documentId skaler). */
export type CustomerConsentInput = Prisma.ConsentUncheckedCreateWithoutUserInput;
