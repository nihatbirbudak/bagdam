import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { MeAddress, MeConsent, MeOrderListResponse, Order, PaymentMethod } from '@bagdam/shared';
import { IysStatus, Prisma } from '@prisma/client';
import { DEFAULT_CONSENT_SOURCE } from '../content/content.constants';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import type { UpsertAddressDto } from './dto/address.dto';
import type { MeConsentDto } from './dto/consent.dto';
import { latestConsentPerKind, toMeAddress, toMeConsent, toPaymentMethodDto } from './me.mapper';
import { MeRepository, type AddressWriteInput } from './me.repository';

/** Pazarlama onayı için varsayılan belge (LegalDocument slug; yayındaki sürüm bağlanır, yoksa null). */
export const MARKETING_CONSENT_DOC_SLUG = 'ticari-ileti-izni';

/** `POST /me/consents` istek bağlamı (ip/ua controller'dan). */
export interface MeRequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * MeService — oturumdaki müşterinin hesabı (BACKEND-PLANI §3 me satırı): tek adres (upsert, aktif bölge doğrulaması),
 * onaylar (tür başına son durum; pazarlama izni değişikliği → yeni Consent satırı + iysStatus PENDING + User.marketingOptIn),
 * siparişler (OrdersService), saklı kartlar (F8: PaymentsService — liste/pasifleştirme; ekleme checkout iFrame'inde).
 */
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly repo: MeRepository,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  // ── Adres ───────────────────────────────────────────────────────────────────

  async getAddress(userId: string): Promise<MeAddress | null> {
    const row = await this.repo.findDefaultAddress(userId);
    return row ? toMeAddress(row) : null;
  }

  /** zoneId ya da zoneSlug zorunlu → aktif bölge (yoksa 400 ZONE_INVALID); varsa güncelle, yoksa oluştur (isDefault true). */
  async upsertAddress(userId: string, dto: UpsertAddressDto): Promise<MeAddress> {
    const zoneId = await this.resolveZoneId(dto.zoneId, dto.zoneSlug);
    const data: AddressWriteInput = { fullName: dto.fullName, phone: dto.phone, line: dto.line, zoneId, zip: dto.zip ?? null };
    const existing = await this.repo.findDefaultAddress(userId);
    if (existing) return toMeAddress(await this.repo.updateAddress(existing.id, data));
    try {
      return toMeAddress(await this.repo.createAddress(userId, data));
    } catch (err) {
      // Eşzamanlı iki PUT: kısmi tekil indeks (addresses_one_default) ikinciyi reddeder → var olanı güncelle
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const row = await this.repo.findDefaultAddress(userId);
        if (row) return toMeAddress(await this.repo.updateAddress(row.id, data));
      }
      throw err;
    }
  }

  // ── Onaylar ─────────────────────────────────────────────────────────────────

  async listConsents(userId: string): Promise<MeConsent[]> {
    return latestConsentPerKind(await this.repo.findConsents(userId));
  }

  /** Pazarlama izni (MARKETING_EMAIL/SMS): yeni satır, iysStatus PENDING (İYS P2'de senkron), MARKETING_EMAIL → User.marketingOptIn. */
  async setConsent(userId: string, dto: MeConsentDto, ctx: MeRequestContext = {}): Promise<MeConsent> {
    const documentId = await this.repo.findCurrentLegalIdBySlug(MARKETING_CONSENT_DOC_SLUG);
    const row = await this.repo.createConsent(
      {
        userId,
        kind: dto.kind,
        granted: dto.granted,
        documentId,
        source: DEFAULT_CONSENT_SOURCE,
        ipAddress: ctx.ip ? ctx.ip.slice(0, 64) : null,
        userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
        iysStatus: IysStatus.PENDING,
      },
      dto.kind === 'MARKETING_EMAIL' ? dto.granted : null,
    );
    this.logger.log(`Pazarlama izni güncellendi (uid:${userId}) ${dto.kind}=${dto.granted}`);
    return toMeConsent(row);
  }

  // ── Siparişler (F7/B2: OrdersService) ──────────────────────────────────────

  /** `GET /me/orders` — kullanıcının siparişleri (OrderSummary[], yeni → eski); zarf `{items,total}`. */
  listOrders(userId: string): Promise<MeOrderListResponse> {
    return this.orders.listForUser(userId);
  }

  /** `GET /me/orders/:orderNo` — sahip değilse 404 ORDER_NOT_FOUND. */
  getOrder(userId: string, orderNo: number): Promise<Order> {
    return this.orders.getForUser(userId, orderNo);
  }

  // ── Saklı kartlar (F8) ──────────────────────────────────────────────────────

  /** `GET /me/cards` — aktif PaymentMethod satırları (PSP token özeti). */
  async listCards(userId: string): Promise<PaymentMethod[]> {
    return (await this.payments.listCardsForUser(userId)).map(toPaymentMethodDto);
  }

  /** `DELETE /me/cards/:id` — isActive=false; sahip değilse 404 CARD_NOT_FOUND. */
  async deleteCard(userId: string, cardId: string): Promise<PaymentMethod> {
    return toPaymentMethodDto(await this.payments.deactivateCard(userId, cardId));
  }

  // ── Yardımcılar ─────────────────────────────────────────────────────────────

  private async resolveZoneId(zoneId: string | undefined, zoneSlug: string | undefined): Promise<string> {
    if (!zoneId && !zoneSlug) {
      throw new BadRequestException({ message: 'Teslimat bölgesi gerekli (zoneId ya da zoneSlug)', error: 'ZONE_REQUIRED' });
    }
    const zone = zoneId ? await this.repo.findActiveZoneById(zoneId) : await this.repo.findActiveZoneBySlug(zoneSlug!);
    if (!zone) {
      throw new BadRequestException({ message: 'Geçersiz ya da hizmet dışı teslimat bölgesi', error: 'ZONE_INVALID' });
    }
    return zone.id;
  }
}
