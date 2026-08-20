import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PAYMENT_PROVIDER_NAMES, paymentProviderNameFromEnum, type PaymentProvider as PaymentProviderEnum, type PaymentProviderName } from '@bagdam/shared';
import { SettingsService } from '../../settings/settings.service';
import { ManualProvider } from './manual.provider';
import type { PaymentProvider } from './payment-provider.interface';
import { PayTrProvider } from './paytr/paytr.provider';

function isProviderName(value: unknown): value is PaymentProviderName {
  return typeof value === 'string' && (PAYMENT_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * PaymentProviderFactory — aktif sağlayıcıyı çözer (UA `PaymentGatewayFactory` kalıbı).
 * Sıra: Setting `payment.provider` (panelden yazılmış satır varsa) → env `PAYMENT_PROVIDER` → Setting varsayılanı (`manual`).
 * Kayıtlı sağlayıcılar: `manual` (F7) · `paytr` (F8, ADR-0019). `iyzico` P2 — seçilirse 503 `PAYMENT_PROVIDER_UNAVAILABLE`.
 * Saklı karttan tahsilatta kartın sağlayıcısı esastır: `getByEnum(paymentMethod.provider)`.
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly byName: Map<PaymentProviderName, PaymentProvider>;
  /** Üretimde "manual" uyarısı yalnız bir kez yazılır (her checkout'ta değil). */
  private manualInProductionWarned = false;

  constructor(
    private readonly settings: SettingsService,
    private readonly manual: ManualProvider,
    private readonly paytr: PayTrProvider,
  ) {
    this.byName = new Map<PaymentProviderName, PaymentProvider>([
      ['manual', this.manual],
      ['paytr', this.paytr],
    ]);
    // P2: this.byName.set('iyzico', iyzicoProvider);
  }

  /** Aktif sağlayıcı adı (Setting → env → varsayılan). */
  async resolveName(): Promise<PaymentProviderName> {
    try {
      const group = await this.settings.getGroup('payment');
      const field = group.fields.find((f) => f.key === 'provider');
      if (field && field.updatedAt !== null && isProviderName(field.value)) return field.value; // panelden yazılmış satır
      const fromEnv = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
      if (isProviderName(fromEnv)) return fromEnv;
      if (field && isProviderName(field.value)) return field.value; // registry varsayılanı
    } catch (err) {
      this.logger.warn(`payment.provider okunamadı, env/varsayılan kullanılıyor: ${(err as Error).message}`);
      const fromEnv = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
      if (isProviderName(fromEnv)) return fromEnv;
    }
    return 'manual';
  }

  async getActive(): Promise<PaymentProvider> {
    const name = await this.resolveName();
    // Manuel sağlayıcı gerçek tahsilat yapmaz (checkout anında PAID) — üretimde seçiliyse tek seferlik uyarı (F11 checklist).
    if (name === 'manual' && process.env.NODE_ENV === 'production' && !this.manualInProductionWarned) {
      this.manualInProductionWarned = true;
      this.logger.error('DİKKAT: üretimde ödeme sağlayıcısı "manual" — gerçek tahsilat YAPILMAZ. Ayarlar › Ödeme › Sağlayıcı = PayTR olmalı.');
    }
    return this.get(name);
  }

  get(name: PaymentProviderName): PaymentProvider {
    const provider = this.byName.get(name);
    if (!provider) {
      throw new ServiceUnavailableException({
        message: `Ödeme sağlayıcısı henüz etkin değil: ${name}`,
        error: 'PAYMENT_PROVIDER_UNAVAILABLE',
      });
    }
    return provider;
  }

  /** Prisma enum (Payment.provider / PaymentMethod.provider) → sağlayıcı. IYZICO (P2) → 503. */
  getByEnum(value: PaymentProviderEnum): PaymentProvider {
    const name = paymentProviderNameFromEnum(value);
    if (!name) {
      throw new ServiceUnavailableException({ message: `Desteklenmeyen ödeme sağlayıcısı: ${value}`, error: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    }
    return this.get(name);
  }

  listProviders(): PaymentProviderName[] {
    return Array.from(this.byName.keys());
  }
}
