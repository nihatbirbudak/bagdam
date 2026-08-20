import { Injectable } from '@nestjs/common';
import type { LeadStatus, Prisma, WholesaleLead } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type LeadRecord = WholesaleLead;

export interface LeadCreateInput {
  email: string;
  businessName: string | null;
  phone: string | null;
  note: string | null;
  ip: string | null;
}

export interface LeadFilter {
  status?: LeadStatus;
}

/** WholesaleRepository — WholesaleLead; Prisma YALNIZ burada (ADR-0002). */
@Injectable()
export class WholesaleRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: LeadCreateInput): Promise<LeadRecord> {
    return this.prisma.wholesaleLead.create({ data });
  }

  async list(filter: LeadFilter, skip: number, take: number): Promise<{ rows: LeadRecord[]; total: number }> {
    const where: Prisma.WholesaleLeadWhereInput = filter.status ? { status: filter.status } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.wholesaleLead.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.wholesaleLead.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string): Promise<LeadRecord | null> {
    return this.prisma.wholesaleLead.findUnique({ where: { id } });
  }

  update(id: string, data: { status?: LeadStatus; note?: string | null }): Promise<LeadRecord> {
    return this.prisma.wholesaleLead.update({ where: { id }, data });
  }
}
