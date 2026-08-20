import { ConflictException, Injectable } from '@nestjs/common';
import { OrdersRepository } from './orders.repository';
import type { Tx } from './orders.types';

/**
 * ORDERS_DEPS — OrdersService'in dış bağımlılığı: DeliveryDate atomik rezerv/iade (B1 `DeliveryDatesService.reserve/release`
 * ile AYNI imza: `reserve(deliveryDateId, tx?)` 0 satır → 409 DAY_FULL · `release(deliveryDateId, tx?)`).
 * OrdersModule `{ provide: ORDERS_DEPS, useExisting: DeliveryDatesService }` ile bağlar (E entegrasyonu, yapısal uyum — reserve
 * başarıda güncel satırı döner, çağıran sonucu kullanmaz); `PrismaOrdersDeps` (aynı SQL, OrdersRepository üzerinden) testlerin
 * casus sarmalayıcısında kalır.
 */
export const ORDERS_DEPS = Symbol('ORDERS_DEPS');

export interface OrdersDeps {
  /** `UPDATE delivery_dates SET reserved=reserved+1 WHERE id=$1 AND reserved<capacity AND status='OPEN'` → 0 satır ise 409 `DAY_FULL`. */
  reserve(deliveryDateId: string, tx?: Tx): Promise<void>;
  /** `reserved = GREATEST(reserved-1, 0)` — iptal/iade/atlama yan etkisi; idempotent değil, çağıran geçiş başına bir kez çağırır. */
  release(deliveryDateId: string, tx?: Tx): Promise<void>;
}

/** Yedek uygulama (testler casus sarmalayıcıyla kullanır; üretimde ORDERS_DEPS = DeliveryDatesService) — SQL OrdersRepository'de (ADR-0002). */
@Injectable()
export class PrismaOrdersDeps implements OrdersDeps {
  constructor(private readonly repo: OrdersRepository) {}

  async reserve(deliveryDateId: string, tx?: Tx): Promise<void> {
    const affected = await this.repo.reserveDeliveryDate(deliveryDateId, tx);
    if (affected === 0) {
      throw new ConflictException({ message: 'Seçilen teslimat günü dolu ya da kapalı', error: 'DAY_FULL' });
    }
  }

  async release(deliveryDateId: string, tx?: Tx): Promise<void> {
    await this.repo.releaseDeliveryDate(deliveryDateId, tx);
  }
}
