import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PAYMENT_PROVIDER_NAMES, paymentProviderNameFromEnum, type PaymentProvider as PaymentProviderEnum, type PaymentProviderName } from '@bagdam/shared';
import { SettingsService } from '../../settings/settings.service';
import { ManualProvider } from './manual.provider';
import type { PaymentProvider } from './payment-provider.interface';

function isProviderName(value: unknown): value is PaymentProviderName {
  return typeof value === 'string' && (PAYMENT_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * PaymentProviderFactory — aktif sağlayıcıyı çözer (UA `PaymentGatewayFactory` kalıbı).
 * Sıra: Setting `payment.provider` (panelden yazılmış satır varsa) → env `PAYMENT_PROVIDER` → Setting varsayılanı (`manual`).
 * `iyzico` F8'de eklenir; o güne kadar seçilirse 503 `PAYMENT_PROVIDER_UNAVAILABLE` (checkout kapalı mesajı F8).
 * Saklı karttan tahsilatta kartın sağlayıcısı esastır: `getByEnum(paymentMethod.provider)`.
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly byName: Map<PaymentProviderName, PaymentProvider>;

  constructor(
    private readonly settings: SettingsService,
    private readonly manual: ManualProvider,
  ) {
    this.byName = new Map<PaymentProviderName, PaymentProvider>([['manual', this.manual]]);
    // F8: this.byName.set('iyzico', iyzicoProvider);
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
    return this.get(await this.resolveName());
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

  /** Prisma enum (Payment.provider / PaymentMethod.provider) → sağlayıcı. PAYTR (P2) → 503. */
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
