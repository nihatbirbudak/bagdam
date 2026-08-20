import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AdminCustomerAnonymizeResult, AdminCustomerDetail, AdminCustomerList, AdminCustomerListItem } from '@bagdam/shared';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { toAdminConsent, toMeAddress } from '../me/me.mapper';
import { MeRepository } from '../me/me.repository';
import { toCustomerAuditItem, toCustomerDetail, toCustomerListItem } from './customers.mapper';
import { CustomersRepository, type CustomerPatchInput, type UserRecord } from './customers.repository';
import type { CustomerPatchDto } from './dto/customer-patch.dto';
import type { CustomerQueryDto } from './dto/customer-query.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
/** Anonim e-posta alanı (KVKK) — `anon+<id>@anon.local`. */
export const ANONYMIZED_EMAIL_DOMAIN = 'anon.local';

export interface CustomerPatchResult {
  item: AdminCustomerListItem;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
}

/**
 * CustomersService — ekran 16 Müşteriler (BACKEND-PLANI §3 customers satırı, §4 ekran 16):
 *  - liste (arama/rol/sayfalama), detay (profil + adres + onaylar + audit özeti; sipariş/abonelik F8/F9),
 *  - PATCH isActive/name/phone (isActive=false → refresh hash null: oturumlar düşer; kendi hesabını kapatamaz),
 *  - anonimleştir (KVKK, ADR-0015): yalnız CUSTOMER, bir kez; e-posta anon+id@anon.local, ad/telefon/adres silinir,
 *    parola rastgele, oturumlar düşer, isActive false, anonymizedAt. Consent satırları (hukuki kanıt) kalır — PII kullanıcı satırındaydı.
 */
@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly repo: CustomersRepository,
    private readonly meRepo: MeRepository,
  ) {}

  async list(query: CustomerQueryDto): Promise<AdminCustomerList> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const { rows, total } = await this.repo.list({ q: query.q || undefined, role: query.role }, (page - 1) * limit, limit);
    return { items: rows.map(toCustomerListItem), total, page, limit };
  }

  async get(id: string): Promise<AdminCustomerDetail> {
    const user = await this.require(id);
    const [address, consents, audit] = await Promise.all([
      this.meRepo.findDefaultAddress(id),
      this.meRepo.findConsents(id),
      this.repo.findAuditSummary(id),
    ]);
    return toCustomerDetail(user, address ? toMeAddress(address) : null, consents.map(toAdminConsent), audit.map(toCustomerAuditItem));
  }

  async patch(id: string, dto: CustomerPatchDto, actorId: string | undefined): Promise<CustomerPatchResult> {
    if (dto.isActive === undefined && dto.name === undefined && dto.phone === undefined) {
      throw new BadRequestException('En az bir alan gerekli: isActive, name, phone');
    }
    const user = await this.require(id);
    if (user.anonymizedAt) throw new ConflictException({ message: 'Anonimleştirilmiş hesap düzenlenemez', error: 'ALREADY_ANONYMIZED' });
    if (dto.isActive === false && actorId === id) {
      throw new BadRequestException({ message: 'Kendi hesabınızı devre dışı bırakamazsınız', error: 'SELF_DEACTIVATE' });
    }
    const data: CustomerPatchInput = {};
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
      if (!dto.isActive) data.refreshTokenHash = null; // oturumlar düşer
    }
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone === null || dto.phone === '' ? null : dto.phone;
    const updated = await this.repo.update(id, data);
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    if (data.isActive !== undefined) {
      oldValues.isActive = user.isActive;
      newValues.isActive = data.isActive;
    }
    if (data.name !== undefined) {
      oldValues.name = user.name;
      newValues.name = data.name;
    }
    if (data.phone !== undefined) {
      oldValues.phone = user.phone;
      newValues.phone = data.phone;
    }
    this.logger.log(`Müşteri güncellendi (uid:${id}): ${Object.keys(newValues).join(', ')}`);
    return { item: toCustomerListItem(updated), oldValues, newValues };
  }

  async anonymize(id: string, actorId: string | undefined): Promise<AdminCustomerAnonymizeResult> {
    const user = await this.require(id);
    if (user.anonymizedAt) throw new ConflictException({ message: 'Hesap zaten anonimleştirilmiş', error: 'ALREADY_ANONYMIZED' });
    if (user.role !== 'CUSTOMER') throw new ConflictException({ message: 'Yalnız müşteri hesapları anonimleştirilir', error: 'NOT_CUSTOMER' });
    if (actorId === id) throw new BadRequestException({ message: 'Kendi hesabınızı anonimleştiremezsiniz', error: 'SELF_ANONYMIZE' });
    const now = new Date();
    const email = `anon+${id}@${ANONYMIZED_EMAIL_DOMAIN}`;
    // Rastgele parola hash'i — hesap kapalı; yine de eski parola ile eşleşme kalmasın
    const passwordHash = await bcrypt.hash(randomBytes(24).toString('hex'), 10);
    const updated = await this.repo.anonymize(id, { email, passwordHash, anonymizedAt: now });
    this.logger.warn(`Müşteri anonimleştirildi (uid:${id})`);
    return { id: updated.id, email: updated.email, anonymizedAt: now.toISOString() };
  }

  private async require(id: string): Promise<UserRecord> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException('Müşteri bulunamadı');
    return user;
  }
}
