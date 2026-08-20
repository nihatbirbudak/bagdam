import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JwtSecrets,
  loadJwtSecrets,
  REFRESH_TOKEN_TTL_SECONDS,
  TokenType,
} from '../../config/jwt.config';
import { AuthMeDto, AuthUserDto, toAuthMe, toAuthUser, toSessionUser } from './auth.mapper';
import { AuthRepository } from './auth.repository';
import type { IssuedTokens, JwtPayload, SessionResolution } from './auth.types';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { UpdateMeDto } from './dto/update-me.dto';

/** Parola bcrypt maliyeti — database/seeds/seed.ts ile aynı (12). */
export const PASSWORD_BCRYPT_ROUNDS = 12;
/** Refresh token digest'i için maliyet — girdi 256 bit rastgele, düşük maliyet yeterli. */
const REFRESH_HASH_BCRYPT_ROUNDS = 10;
/** ADR-0009: 5 ardışık hata → 30 dk kilit. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 30 * 60 * 1000;
/** Sözleşme metni — admin/cart.js bu mesajı gösterir. */
export const INVALID_CREDENTIALS_MESSAGE = 'E-posta veya parola hatalı';

export interface LoginResult {
  user: AuthUserDto;
  tokens: IssuedTokens;
}

/**
 * AuthService — kimlik kuralları (ADR-0009): e-posta+parola (bcrypt), access 15 dk + refresh 30 gün rotasyonlu,
 * refresh hash'i DB'de, 5 hata → 30 dk kilit. Çerez/başlık işleri controller'da; Prisma AuthRepository'de.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secrets: JwtSecrets;
  /** Kullanıcı yokken de bcrypt çalıştırılır (zamanlama ile e-posta keşfini zorlaştırır). */
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    private readonly repo: AuthRepository,
    private readonly jwt: JwtService,
  ) {
    this.secrets = loadJwtSecrets();
  }

  // ── Login / refresh / logout ─────────────────────────────────────────────

  async login(rawEmail: string, password: string): Promise<LoginResult> {
    const email = rawEmail.trim().toLowerCase();
    const now = new Date();
    const user = await this.repo.findByEmail(email);

    if (!user || user.deletedAt) {
      await this.compareAgainstDummy(password);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      throw this.lockedException(user.lockedUntil, now);
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      await this.registerFailedAttempt(user, now);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Hesap devre dışı bırakılmış');
    }

    const tokens = await this.issueTokens(user);
    await this.repo.recordLoginSuccess(user.id, await this.hashRefreshToken(tokens.refreshToken), now);
    return { user: toAuthUser(user), tokens };
  }

  /** Refresh rotasyonu: imza + typ + DB hash eşleşmesi → yeni çift; eski çift geçersiz. */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = await this.verifyToken(refreshToken, 'refresh');
    if (!payload) {
      throw new UnauthorizedException({ message: 'Oturum süresi doldu, yeniden giriş yapın', error: 'REFRESH_INVALID' });
    }

    const user = await this.repo.findById(payload.sub);
    if (!user || user.deletedAt || !user.isActive || !user.refreshTokenHash) {
      throw new UnauthorizedException({ message: 'Oturum geçersiz, yeniden giriş yapın', error: 'REFRESH_INVALID' });
    }

    const matches = await bcrypt.compare(this.digestRefreshToken(refreshToken), user.refreshTokenHash);
    if (!matches) {
      throw new UnauthorizedException({ message: 'Oturum geçersiz, yeniden giriş yapın', error: 'REFRESH_INVALID' });
    }

    const tokens = await this.issueTokens(user);
    const rotated = await this.repo.rotateRefreshTokenHash(
      user.id,
      user.refreshTokenHash,
      await this.hashRefreshToken(tokens.refreshToken),
    );
    if (!rotated) {
      // Eşzamanlı yenileme yarışı: başka istek rotasyonu tamamladı; bu token artık geçersiz.
      throw new UnauthorizedException({ message: 'Oturum yenilendi, tekrar deneyin', error: 'REFRESH_INVALID' });
    }
    return { user: toAuthUser(user), tokens };
  }

  /**
   * Çıkış: refresh hash'i silinir. Kullanıcı access token'dan (req.user) ya da — access süresi dolmuşsa —
   * refresh çerezinden bulunur; hiçbiri yoksa sessizce geçer (çerezler yine de temizlenir).
   */
  async logout(userId: string | undefined, refreshToken: string | undefined): Promise<void> {
    let id = userId;
    if (!id && refreshToken) {
      const payload = await this.verifyToken(refreshToken, 'refresh');
      id = payload?.sub;
    }
    if (!id) return;
    await this.repo.setRefreshTokenHash(id, null).catch((err: Error) => {
      this.logger.warn(`logout: refresh hash temizlenemedi (uid:${id}): ${err.message}`);
    });
  }

  // ── Oturum çözümleme (JwtAuthGuard) ──────────────────────────────────────

  /** Access token → DB'de aktif kullanıcı. Her istekte çalışır; süresi dolmuş/geçersiz ayrımı istemciye kod olarak gider. */
  async resolveSession(accessToken: string): Promise<SessionResolution> {
    const verified = await this.verifyTokenDetailed(accessToken, 'access');
    if (!verified.ok) return { ok: false, reason: verified.reason };
    const row = await this.repo.findSessionUser(verified.payload.sub);
    if (!row || !row.isActive || row.deletedAt) return { ok: false, reason: 'inactive' };
    return { ok: true, user: toSessionUser(row) };
  }

  // ── Me ───────────────────────────────────────────────────────────────────

  async getMe(userId: string): Promise<AuthMeDto> {
    const row = await this.repo.findMe(userId);
    if (!row || row.deletedAt || !row.isActive) {
      throw new UnauthorizedException({ message: 'Oturum geçersiz', error: 'UNAUTHENTICATED' });
    }
    return toAuthMe(row);
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<AuthMeDto> {
    const data: { name?: string; phone?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone === null || dto.phone.trim() === '' ? null : dto.phone.trim();
    const row = await this.repo.updateProfile(userId, data);
    return toAuthMe(row);
  }

  /** Parola değişimi: mevcut parola doğrulanır; yeni token çifti üretilir (eski refresh geçersiz). */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<IssuedTokens> {
    const user = await this.repo.findById(userId);
    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException({ message: 'Oturum geçersiz', error: 'UNAUTHENTICATED' });
    }
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({ message: 'Mevcut parola hatalı', error: 'CURRENT_PASSWORD_INVALID' });
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, PASSWORD_BCRYPT_ROUNDS);
    const tokens = await this.issueTokens(user);
    await this.repo.updatePassword(user.id, passwordHash, await this.hashRefreshToken(tokens.refreshToken));
    return tokens;
  }

  // ── CSRF ─────────────────────────────────────────────────────────────────

  /** Double-submit çerez değeri: 32 bayt rastgele, hex. HMAC gerekmez (çerez+başlık eşitliği yeter). */
  createCsrfToken(): string {
    return randomBytes(32).toString('hex');
  }

  // ── Yardımcılar ───────────────────────────────────────────────────────────

  private async issueTokens(user: Pick<User, 'id' | 'email' | 'role'>): Promise<IssuedTokens> {
    const base = { sub: user.id, role: user.role, email: user.email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...base, typ: 'access', jti: randomUUID() } satisfies JwtPayload,
        { secret: this.secrets.access, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      ),
      this.jwt.signAsync(
        { ...base, typ: 'refresh', jti: randomUUID() } satisfies JwtPayload,
        { secret: this.secrets.refresh, expiresIn: REFRESH_TOKEN_TTL_SECONDS },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  private async verifyToken(token: string, typ: TokenType): Promise<JwtPayload | null> {
    const result = await this.verifyTokenDetailed(token, typ);
    return result.ok ? result.payload : null;
  }

  private async verifyTokenDetailed(
    token: string,
    typ: TokenType,
  ): Promise<{ ok: true; payload: JwtPayload } | { ok: false; reason: 'expired' | 'invalid' }> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: typ === 'access' ? this.secrets.access : this.secrets.refresh,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      return { ok: false, reason: name === 'TokenExpiredError' ? 'expired' : 'invalid' };
    }
    if (!payload || typeof payload.sub !== 'string' || payload.typ !== typ) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, payload };
  }

  /**
   * bcrypt girdiyi 72 baytta keser; JWT'nin ilk 72 baytı (header + sub) aynı kullanıcı için hep aynıdır.
   * Bu yüzden önce SHA-256 digest (64 hex karakter) alınır, bcrypt ona uygulanır — tüm entropi korunur.
   */
  private digestRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashRefreshToken(token: string): Promise<string> {
    return bcrypt.hash(this.digestRefreshToken(token), REFRESH_HASH_BCRYPT_ROUNDS);
  }

  private async registerFailedAttempt(user: User, now: Date): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    const lockedUntil = shouldLock ? new Date(now.getTime() + LOCK_DURATION_MS) : null;
    try {
      await this.repo.recordFailedLogin(user.id, shouldLock ? 0 : attempts, lockedUntil);
    } catch (err) {
      // Sayaç yazılamasa da yanıt 401 kalmalı (500'e dönüşmesin)
      this.logger.error(`Hatalı giriş sayacı güncellenemedi (uid:${user.id}): ${(err as Error).message}`);
    }
    if (shouldLock && lockedUntil) {
      this.logger.warn(`Hesap kilitlendi: ${MAX_FAILED_LOGIN_ATTEMPTS} ardışık hatalı giriş (uid:${user.id})`);
      throw this.lockedException(lockedUntil, now);
    }
  }

  private lockedException(lockedUntil: Date, now: Date): HttpException {
    const remainingMin = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000));
    return new HttpException(
      {
        statusCode: HttpStatus.LOCKED,
        message: `Çok sayıda hatalı deneme nedeniyle hesap geçici olarak kilitlendi. ${remainingMin} dakika sonra tekrar deneyin.`,
        error: 'Locked',
      },
      HttpStatus.LOCKED,
    );
  }

  private async compareAgainstDummy(password: string): Promise<void> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = bcrypt.hash(randomBytes(16).toString('hex'), PASSWORD_BCRYPT_ROUNDS);
    }
    await bcrypt.compare(password, await this.dummyHashPromise);
  }
}
