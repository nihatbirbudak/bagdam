import { Injectable } from '@nestjs/common';
import { IysStatus, Prisma, type Consent, type DeliveryZone } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export const ADDRESS_WITH_ZONE_INCLUDE = { zone: { select: { slug: true, name: true } } } satisfies Prisma.AddressInclude;
export type AddressRecord = Prisma.AddressGetPayload<{ include: typeof ADDRESS_WITH_ZONE_INCLUDE }>;

export const CONSENT_WITH_DOC_INCLUDE = { document: { select: { slug: true, version: true } } } satisfies Prisma.ConsentInclude;
export type ConsentRecord = Prisma.ConsentGetPayload<{ include: typeof CONSENT_WITH_DOC_INCLUDE }>;

export interface AddressWriteInput {
  fullName: string;
  phone: string;
  line: string;
  zoneId: string;
  zip: string | null;
}

export interface ConsentWriteInput {
  userId: string;
  kind: Consent['kind'];
  granted: boolean;
  documentId: string | null;
  source: string;
  ipAddress: string | null;
  userAgent: string | null;
  iysStatus: IysStatus;
}

/**
 * MeRepository — oturumdaki müşterinin adresi (tek adres MVP), onayları ve bölge doğrulaması; Prisma YALNIZ burada (ADR-0002).
 * Zaman parametreyle (ADR-0004). `addresses_one_default` kısmi tekil indeksi (0002_raw_core): kullanıcı başına tek
 * varsayılan (silinmemiş) adres — upsert servis tarafında "bul → güncelle / oluştur" ile yapılır.
 */
@Injectable()
export class MeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDefaultAddress(userId: string): Promise<AddressRecord | null> {
    return this.prisma.address.findFirst({
      where: { userId, isDefault: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: ADDRESS_WITH_ZONE_INCLUDE,
    });
  }

  createAddress(userId: string, data: AddressWriteInput): Promise<AddressRecord> {
    return this.prisma.address.create({ data: { userId, ...data, isDefault: true }, include: ADDRESS_WITH_ZONE_INCLUDE });
  }

  updateAddress(id: string, data: AddressWriteInput): Promise<AddressRecord> {
    return this.prisma.address.update({ where: { id }, data, include: ADDRESS_WITH_ZONE_INCLUDE });
  }

  findActiveZoneById(id: string): Promise<DeliveryZone | null> {
    return this.prisma.deliveryZone.findFirst({ where: { id, isActive: true } });
  }

  findActiveZoneBySlug(slug: string): Promise<DeliveryZone | null> {
    return this.prisma.deliveryZone.findFirst({ where: { slug, isActive: true } });
  }

  /** Kullanıcının tüm onayları (yeni → eski). */
  findConsents(userId: string): Promise<ConsentRecord[]> {
    return this.prisma.consent.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: CONSENT_WITH_DOC_INCLUDE });
  }

  /** Onay + (pazarlama e-postası için) User.marketingOptIn aynı işlemde. */
  async createConsent(input: ConsentWriteInput, marketingOptIn: boolean | null): Promise<ConsentRecord> {
    const [row] = await this.prisma.$transaction([
      this.prisma.consent.create({ data: input, include: CONSENT_WITH_DOC_INCLUDE }),
      ...(marketingOptIn === null ? [] : [this.prisma.user.update({ where: { id: input.userId }, data: { marketingOptIn }, select: { id: true } })]),
    ]);
    return row;
  }

  findCurrentLegalIdBySlug(slug: string): Promise<string | null> {
    return this.prisma.legalDocument.findFirst({ where: { slug, isCurrent: true }, select: { id: true } }).then((r) => r?.id ?? null);
  }
}
