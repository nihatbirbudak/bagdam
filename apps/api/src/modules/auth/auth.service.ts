import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IysStatus, Prisma, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JwtSecrets,
  loadJwtSecrets,
  REFRESH_TOKEN_TTL_SECONDS,
  TokenType,
} from '../../config/jwt.config';
import { DEFAULT_CONSENT_SOURCE } from '../content/content.constants';
import { ContentService } from '../content/content.service';
import { RESET_LINK_MINUTES, webUrl } from '../mail/mail.constants';
import { NOTIFIER, type Notifier } from '../mail/notifier.interface';
import { AuthMeDto, AuthUserDto, toAuthMe, toAuthUser, toSessionUser } from './auth.mapper';
import { AuthRepository, type CustomerConsentInput } from './auth.repository';
import type { IssuedTokens, JwtPayload, SessionResolution, VerifyTokenPayload } from './auth.types';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { RegisterDto } from './dto/register.dto';
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

/** F6 — e-posta doğrulama JWT ömrü (24 saat) ve parola sıfırlama bağlantısı ömrü (60 dk). */
export const VERIFY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const RESET_TOKEN_TTL_MS = RESET_LINK_MINUTES * 60 * 1000;
/** Kayıtta documentSlug verilmezse türün varsayılan yasal belgesi (yayındaki sürüm; yoksa bağlanmaz). */
export const DEFAULT_CONSENT_DOCUMENT_SLUGS: Readonly<Record<'KVKK_ACK' | 'MARKETING_EMAIL' | 'MARKETING_SMS', string>> = {
  KVKK_ACK: 'kvkk',
  MARKETING_EMAIL: 'ticari-ileti-izni',
  MARKETING_SMS: 'ticari-ileti-izni',
};

export interface LoginResult {
  user: AuthUserDto;
  tokens: IssuedTokens;
}

/** İstek bağlamı (onay satırları ip/ua) — controller istekten çıkarır. */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface RegisterResult extends LoginResult {
  /** Kaydedilen onay türleri (audit özeti için; e-posta/telefon buraya girmez). */
  consentKinds: string[];
}

/**
 * AuthService — kimlik kuralları (ADR-0009): e-posta+parola (bcrypt), access 15 dk + refresh 30 gün rotasyonlu,
 * refresh hash'i DB'de, 5 hata → 30 dk kilit. Çerez/başlık işleri controller'da; Prisma AuthRepository'de.
 * F6: kayıt (KVKK zorunlu + Consent satırları tek işlemde + anında giriş + hoş geldin/doğrulama e-postası), e-posta
 * doğrulama (JWT typ:'verify' 24 s), parola unuttum/sıfırla (sha256 token 60 dk; diğer oturumlar düşer; e-posta).
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
    private readonly content: ContentService,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {
    this.secrets = loadJwtSecrets();
  }

  // ── F6: Kayıt ────────────────────────────────────────────────────────────────

  /**
   * Kayıt: KVKK_ACK granted zorunlu (400 KVKK_REQUIRED) · e-posta tekil (409 EMAIL_TAKEN; yarışta P2002 de 409) ·
   * Consent satırları (documentId = slug'ın yayındaki LegalDocument'i; MARKETING_* → iysStatus PENDING) kullanıcıyla aynı
   * işlemde · anında giriş (token çifti + lastLoginAt) · hoş geldin + doğrulama e-postası (Notifier; hata kaydı bozmaz).
   */
  async register(dto: RegisterDto, meta: RequestMeta = {}): Promise<RegisterResult> {
    const email = dto.email.trim().toLowerCase();
    const kvkk = dto.consents.find((c) => c.kind === 'KVKK_ACK' && c.granted === true);
    if (!kvkk) {
      throw new BadRequestException({ message: 'KVKK aydınlatma metnini onaylamanız gerekir', error: 'KVKK_REQUIRED' });
    }
    const existing = await this.repo.findByEmail(email);
    if (existing) {
      throw new ConflictException({ message: 'Bu e-posta zaten kayıtlı', error: 'EMAIL_TAKEN' });
    }

    const consents = await this.buildRegisterConsents(dto, meta);
    const marketingOptIn = dto.consents.some((c) => c.kind === 'MARKETING_EMAIL' && c.granted);
    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_BCRYPT_ROUNDS);

    let user: User;
    try {
      user = await this.repo.createCustomer(
        { email, passwordHash, name: dto.name?.trim() || null, phone: dto.phone?.trim() || null, marketingOptIn },
        consents,
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ message: 'Bu e-posta zaten kayıtlı', error: 'EMAIL_TAKEN' });
      }
      throw err;
    }

    const now = new Date();
    const tokens = await this.issueTokens(user);
    await this.repo.recordLoginSuccess(user.id, await this.hashRefreshToken(tokens.refreshToken), now);
    this.logger.log(`Yeni müşteri kaydı (uid:${user.id})`);

    // E-postalar: hoş geldin + doğrulama bağlantısı (Notifier asla fırlatmaz; DISABLE_MAIL'de MailLog SKIPPED + önizleme)
    const notifierUser = { id: user.id, email: user.email, name: user.name };
    await this.notifier.notify('customer.welcome', { user: notifierUser });
    await this.notifier.notify('customer.verify', { user: notifierUser, verifyUrl: await this.buildVerifyUrl(user) });

    return { user: toAuthUser(user), tokens, consentKinds: consents.map((c) => c.kind) };
  }

  // ── F6: E-posta doğrulama ───────────────────────────────────────────────────

  /** Doğrulama bağlantısı: `${WEB_URL}/api/v1/auth/verify?token=<jwt typ:verify 24 s>` (WEB_URL yoksa göreli). */
  async buildVerifyUrl(user: Pick<User, 'id'>): Promise<string> {
    const token = await this.jwt.signAsync(
      { sub: user.id, typ: 'verify', jti: randomUUID() } satisfies VerifyTokenPayload,
      { secret: this.secrets.access, expiresIn: VERIFY_TOKEN_TTL_SECONDS },
    );
    return `${webUrl()}/api/v1/auth/verify?token=${encodeURIComponent(token)}`;
  }

  /** Token geçerli ve kullanıcı aktifse emailVerifiedAt=now (ilk kez) → true; geçersiz/süresi dolmuş/kullanıcı yok → false. */
  async verifyEmail(token: string): Promise<boolean> {
    let payload: VerifyTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<VerifyTokenPayload>(token, { secret: this.secrets.access });
    } catch {
      return false;
    }
    if (!payload || typeof payload.sub !== 'string' || payload.typ !== 'verify') return false;
    const user = await this.repo.findById(payload.sub);
    if (!user || user.deletedAt || !user.isActive) return false;
    if (user.emailVerifiedAt) return true; // idempotent: tekrar tıklama da başarı sayfasına gider
    const marked = await this.repo.markEmailVerified(user.id, new Date());
    if (marked) this.logger.log(`E-posta doğrulandı (uid:${user.id})`);
    return true;
  }

  // ── F6: Parola unuttum / sıfırla ────────────────────────────────────────────

  /**
   * Her zaman sessiz başarı (e-posta keşfi yok). Kullanıcı varsa ve aktifse: ham token (32 bayt hex) e-postaya,
   * sha256 özeti DB'ye (+60 dk). Bağlantı: `${WEB_URL}/uyelik.html?sifirla=<token>`.
   */
  async forgotPassword(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.repo.findByEmail(email);
    if (!user || user.deletedAt || !user.isActive || user.anonymizedAt) {
      // Sessiz başarı: yanıt ve durum kodu kullanıcı var/yok ayrımı yapmaz (e-posta keşfi yok); e-posta log'a yazılmaz (ADR-0015)
      this.logger.log('Parola sıfırlama: bilinmeyen/pasif e-posta (sessiz)');
      return;
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await this.repo.setPasswordResetToken(user.id, this.sha256(token), expiresAt);
    const resetUrl = `${webUrl()}/uyelik.html?sifirla=${token}`;
    await this.notifier.notify('customer.reset', {
      user: { id: user.id, email: user.email, name: user.name },
      resetUrl,
      expiresMinutes: RESET_LINK_MINUTES,
    });
    this.logger.log(`Parola sıfırlama bağlantısı üretildi (uid:${user.id})`);
  }

  /**
   * Token (sha256 eşleşmesi + süre) geçerliyse: yeni parola, token temizlenir, refresh hash yeni oturuma (diğer
   * oturumlar düşer), kilit sıfır; "parolan değişti" e-postası. Geçersiz/süresi dolmuş → 400 RESET_TOKEN_INVALID.
   * Döner: yeni token çifti (controller çerezleri yazar — anında giriş) + kullanıcı.
   */
  async resetPassword(token: string, password: string): Promise<LoginResult> {
    const tokenHash = this.sha256(token);
    const now = new Date();
    const user = await this.repo.findByPasswordResetTokenHash(tokenHash);
    if (!user || user.deletedAt || !user.isActive || !user.passwordResetExpires || user.passwordResetExpires.getTime() <= now.getTime()) {
      throw new BadRequestException({ message: 'Sıfırlama bağlantısı geçersiz ya da süresi dolmuş', error: 'RESET_TOKEN_INVALID' });
    }
    const passwordHash = await bcrypt.hash(password, PASSWORD_BCRYPT_ROUNDS);
    const tokens = await this.issueTokens(user);
    const done = await this.repo.completePasswordReset(user.id, tokenHash, passwordHash, await this.hashRefreshToken(tokens.refreshToken), now);
    if (!done) {
      throw new BadRequestException({ message: 'Sıfırlama bağlantısı geçersiz ya da süresi dolmuş', error: 'RESET_TOKEN_INVALID' });
    }
    this.logger.log(`Parola sıfırlandı (uid:${user.id})`);
    await this.notifier.notify('customer.password-changed', { user: { id: user.id, email: user.email, name: user.name }, changedAt: now });
    return { user: toAuthUser(user), tokens };
  }

  /** Kayıt onayları → Consent create girdileri (documentId: verilen ya da varsayılan slug'ın yayındaki sürümü). */
  private async buildRegisterConsents(dto: RegisterDto, meta: RequestMeta): Promise<CustomerConsentInput[]> {
    const out: CustomerConsentInput[] = [];
    const seen = new Set<string>();
    for (const c of dto.consents) {
      if (seen.has(c.kind)) continue; // aynı tür iki kez gelirse ilki geçerli
      seen.add(c.kind);
      const documentId = await this.resolveConsentDocument(c.kind, c.documentSlug);
      out.push({
        kind: c.kind,
        granted: c.granted,
        documentId,
        source: DEFAULT_CONSENT_SOURCE,
        ipAddress: meta.ip ? meta.ip.slice(0, 64) : null,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 255) : null,
        iysStatus: c.kind === 'MARKETING_EMAIL' || c.kind === 'MARKETING_SMS' ? IysStatus.PENDING : IysStatus.NOT_APPLICABLE,
      });
    }
    return out;
  }

  /** Açık slug bulunamazsa 400 (istemci yanlış belge gönderdi); varsayılan slug yoksa sessizce bağlanmaz. */
  private async resolveConsentDocument(kind: keyof typeof DEFAULT_CONSENT_DOCUMENT_SLUGS, slug: string | undefined): Promise<string | null> {
    if (slug) {
      try {
        return (await this.content.getLegalBySlug(slug)).id;
      } catch (err) {
        if (err instanceof NotFoundException) {
          throw new BadRequestException({ message: `Onay verilecek yasal metin bulunamadı: ${slug}`, error: 'CONSENT_DOCUMENT_NOT_FOUND' });
        }
        throw err;
      }
    }
    try {
      return (await this.content.getLegalBySlug(DEFAULT_CONSENT_DOCUMENT_SLUGS[kind])).id;
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
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
