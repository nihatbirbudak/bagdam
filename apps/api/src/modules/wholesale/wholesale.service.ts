import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { WholesaleLead, WholesaleLeadCreated, WholesaleLeadList } from '@bagdam/shared';
import { NOTIFIER, type Notifier } from '../mail/notifier.interface';
import type { CreateWholesaleLeadDto } from './dto/create-lead.dto';
import type { WholesaleLeadPatchDto } from './dto/lead-patch.dto';
import type { WholesaleLeadQueryDto } from './dto/lead-query.dto';
import { toWholesaleLead } from './wholesale.mapper';
import { WholesaleRepository } from './wholesale.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
/** WholesaleLead.ip VarChar(45). */
const IP_MAX = 45;

/**
 * WholesaleService — toptan talepleri (BACKEND-PLANI §3 wholesale satırı, §4 ekran 13).
 *  - `createLead`: kayıt + ip; F6: Notifier `wholesale.new-lead` → yöneticiye e-posta (Setting site.contactEmail; MailNotifier
 *    asla fırlatmaz, MailLog'a düşer). Aynı e-postadan tekrar talep engellenmez (her gönderim ayrı satır). Throttle 3/dk/IP controller'da.
 *  - Admin: liste (status filtresi, sayfalama), durum/not güncelleme.
 */
@Injectable()
export class WholesaleService {
  private readonly logger = new Logger(WholesaleService.name);

  constructor(
    private readonly repo: WholesaleRepository,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  async createLead(dto: CreateWholesaleLeadDto, ip: string | null | undefined): Promise<WholesaleLeadCreated> {
    const row = await this.repo.create({
      email: dto.email,
      businessName: dto.businessName ?? null,
      phone: dto.phone ?? null,
      note: dto.note ?? null,
      ip: ip ? ip.slice(0, IP_MAX) : null,
    });
    this.logger.log(`Yeni toptan talebi #${row.id}`); // e-posta log'a yazılmaz (ADR-0015)
    await this.notifier.notify('wholesale.new-lead', {
      lead: { id: row.id, email: row.email, businessName: row.businessName, phone: row.phone, note: row.note, createdAt: row.createdAt },
    });
    return { id: row.id };
  }

  async list(query: WholesaleLeadQueryDto): Promise<WholesaleLeadList> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const { rows, total } = await this.repo.list({ status: query.status }, (page - 1) * limit, limit);
    return { items: rows.map(toWholesaleLead), total, page, limit };
  }

  async get(id: string): Promise<WholesaleLead> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Toptan talebi bulunamadı: ${id}`);
    return toWholesaleLead(row);
  }

  async patch(id: string, dto: WholesaleLeadPatchDto): Promise<WholesaleLead> {
    if (dto.status === undefined && dto.note === undefined) throw new BadRequestException('status ya da note verilmeli');
    await this.get(id);
    const row = await this.repo.update(id, {
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.note !== undefined ? { note: dto.note } : {}),
    });
    return toWholesaleLead(row);
  }
}
