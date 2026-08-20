import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentSettings } from '@bagdam/shared';
import { SettingsService } from '../../../settings/settings.service';

/** Çözümlenmiş PayTR yapılandırması (Setting payment.* → .env PAYTR_* yedeği). */
export interface PayTrConfig {
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
  /** test_mode=1 (canlı mağazada test işlemi; gerçek tahsilat yok). */
  testMode: boolean;
  /** Bildirim (callback) IP allowlist; boşsa IP kontrolü yapılmaz (yalnız hash). */
  callbackAllowedIps: string[];
  /** Kayıtlı kart / tekrarlayan tahsilat (utoken/ctoken, non_3d) onayı — kapalıysa chargeStoredCard PROVIDER_FEATURE_DISABLED. */
  storedCardEnabled: boolean;
  nonThreeDsGranted: boolean;
  /** 1 = taksit yok. */
  maxInstallment: number;
  /** maxInstallment ≤ 1 → 1 (tek çekim). */
  noInstallment: 0 | 1;
  currency: 'TL';
  /** Ödeme alma açık (Setting payment.enabled). */
  enabled: boolean;
  /** merchantId/Key/Salt üçü de dolu mu. */
  configured: boolean;
}

export const PAYTR_CURRENCY = 'TL' as const;
export const PAYTR_LANG = 'tr' as const;
/** iFrame oturumu (dakika). */
export const PAYTR_TIMEOUT_LIMIT_MIN = 30;

function envStr(name: string): string {
  return (process.env[name] ?? '').trim();
}

function envBool(name: string): boolean | null {
  const v = envStr(name).toLowerCase();
  if (!v) return null;
  return v === '1' || v === 'true';
}

export function parseIpList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** WEB_URL (sondaki / atılır); yoksa lokal varsayılan (payments.constants.buildPayLinkUrl ile aynı). */
export function webBaseUrl(): string {
  const raw = envStr('WEB_URL').replace(/\/+$/, '');
  return raw || 'http://127.0.0.1:4010';
}

/** PayTR panelinde tanımlanacak bildirim URL'si (global prefix dahil). */
export function paytrCallbackUrl(): string {
  return `${webBaseUrl()}/api/v1/payments/paytr/callback`;
}

/** merchant_ok_url / merchant_fail_url — sepet.html `?siparis=<no>&odeme=ok|hata` (ADR-0010 callback yolu; C polling ile durumu okur). */
export function merchantOkUrl(orderNo: number): string {
  return `${webBaseUrl()}/sepet.html?siparis=${orderNo}&odeme=ok`;
}
export function merchantFailUrl(orderNo: number): string {
  return `${webBaseUrl()}/sepet.html?siparis=${orderNo}&odeme=hata`;
}

/**
 * PayTrConfigService — Setting `payment.*` (SettingsService; sırlar çözülmüş) + `.env PAYTR_*` yedeği:
 *  - merchantId/Key/Salt: Setting dolu → Setting; boş → env (.env.example CHANGE_ME dahil — lokal test callback'i kendi salt'ıyla imzalar).
 *  - testMode: panelden yazılmış satır varsa o; yoksa env PAYTR_TEST_MODE; o da yoksa varsayılan (true).
 *  - callbackAllowedIps: Setting dolu → Setting; boş → env PAYTR_CALLBACK_ALLOWED_IPS.
 * Her çağrıda yeniden çözülür (SettingsService satırları 60 s cache'ler; panelden değişiklik anında yansır).
 */
@Injectable()
export class PayTrConfigService {
  private readonly logger = new Logger(PayTrConfigService.name);

  constructor(private readonly settings: SettingsService) {}

  async load(): Promise<PayTrConfig> {
    let values: Partial<PaymentSettings> = {};
    let testModeRowWritten = false;
    try {
      values = await this.settings.getPayment();
      const group = await this.settings.getGroup('payment');
      testModeRowWritten = group.fields.some((f) => f.key === 'paytrTestMode' && f.updatedAt !== null);
    } catch (err) {
      this.logger.warn(`payment.* ayarları okunamadı, .env PAYTR_* kullanılıyor: ${(err as Error).message}`);
    }
    const merchantId = str(values.paytrMerchantId) || envStr('PAYTR_MERCHANT_ID');
    const merchantKey = str(values.paytrMerchantKey) || envStr('PAYTR_MERCHANT_KEY');
    const merchantSalt = str(values.paytrMerchantSalt) || envStr('PAYTR_MERCHANT_SALT');
    const envTest = envBool('PAYTR_TEST_MODE');
    const testMode = testModeRowWritten ? values.paytrTestMode !== false : envTest !== null ? envTest : values.paytrTestMode !== false;
    const ips = parseIpList(str(values.paytrCallbackAllowedIps));
    const callbackAllowedIps = ips.length > 0 ? ips : parseIpList(envStr('PAYTR_CALLBACK_ALLOWED_IPS'));
    const maxRaw = Number(values.maxInstallment ?? 1);
    const maxInstallment = Number.isInteger(maxRaw) && maxRaw >= 1 && maxRaw <= 12 ? maxRaw : 1;
    return {
      merchantId,
      merchantKey,
      merchantSalt,
      testMode,
      callbackAllowedIps,
      storedCardEnabled: values.storedCardEnabled === true,
      nonThreeDsGranted: values.nonThreeDsGranted === true,
      maxInstallment,
      noInstallment: maxInstallment <= 1 ? 1 : 0,
      currency: PAYTR_CURRENCY,
      enabled: values.enabled === true,
      configured: Boolean(merchantId && merchantKey && merchantSalt),
    };
  }

  /** Mağaza bilgileri eksikse 503 `PAYTR_NOT_CONFIGURED` (checkout kapalı mesajı). */
  requireConfigured(cfg: PayTrConfig): PayTrConfig {
    if (!cfg.configured) {
      throw new ServiceUnavailableException({
        message: 'PayTR mağaza bilgileri tanımlı değil (Ayarlar › Ödeme ya da .env PAYTR_*)',
        error: 'PAYTR_NOT_CONFIGURED',
      });
    }
    return cfg;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
