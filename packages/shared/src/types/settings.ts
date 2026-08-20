// ── Ayarlar (Setting tablosu) DTO'ları ───────────────────────────────────────
import type { ChargeStrategy, DeliveryDaySlug } from '../enums';
import type { Id, IsoDateTime } from './common';

/** Setting satırı — `isSecret` olanların değeri admin'e maskeli döner (`"••••"`). */
export interface Setting {
  key: string;
  group: string;
  value: unknown;
  isSecret: boolean;
  updatedAt: IsoDateTime;
}

/** `GET/PUT /admin/settings/:group` — anahtar → değer. */
export type SettingGroupValues = Record<string, unknown>;

/** Setting `commerce.deliveryDays` öğesi. */
export interface CommerceDeliveryDay {
  id: DeliveryDaySlug;
  label: string;
  /** Haftanın günü: Salı 2, Perşembe 4, Cumartesi 6. */
  dow: number;
}

/** Setting `commerce.frequencies` öğesi (bootstrap FreqOption'a `{id,label,note,allDays:false}` olarak basılır). */
export interface CommerceFrequency {
  id: string;
  weeks: number;
  label: string;
}

/**
 * Setting `commerce.*` anahtarları (BACKEND-PLANI §2 "Setting anahtarları"). Kargo/eşik BURADA YOK (DeliveryZone) [B11].
 * Bootstrap'a gizli olmayan alanlar gider (`BootstrapPayload.commerce`).
 */
export interface CommerceSettings {
  vatRate: number;
  deliveryDays: CommerceDeliveryDay[];
  frequencies: CommerceFrequency[];
  cutoff: { daysBefore: number; time: string };
  firstBoxDiscount: { pct: number; boxes: number; perUserOnce: boolean };
  skipsPerYear: number;
  firstCycleSkippable: boolean;
  retentionOffer: { pct: number; boxes: number; perUserOnce: boolean };
  /** Birim → çarpan listesi; `default` sayılı birimler için. Ör. `{kg:[0.25,0.5,1,2],"500 g":[1,2,3],default:[1,2,3,4]}`. */
  extraAmountOptions: Record<string, number[]>;
  deliveryWindow: string;
  deliveryDatesHorizonWeeks: number;
  dunning: { retryHours: number[]; pastDueAfterUnpaid: number };
  chargeStrategy: ChargeStrategy;
  paymentLinkHours: number;
}

/** Setting varsayılanları — seed ve testlerde tek kaynak (BACKEND-PLANI §2). */
export const COMMERCE_SETTINGS_DEFAULTS: Readonly<CommerceSettings> = {
  vatRate: 1,
  deliveryDays: [
    { id: 'sali', label: 'Salı', dow: 2 },
    { id: 'persembe', label: 'Perşembe', dow: 4 },
    { id: 'cumartesi', label: 'Cumartesi', dow: 6 },
  ],
  frequencies: [
    { id: '1hafta', weeks: 1, label: 'Haftada 1' },
    { id: '2hafta', weeks: 2, label: '2 haftada bir' },
    { id: '4hafta', weeks: 4, label: '4 haftada bir' },
  ],
  cutoff: { daysBefore: 1, time: '12:00' },
  firstBoxDiscount: { pct: 50, boxes: 2, perUserOnce: true },
  skipsPerYear: 1,
  firstCycleSkippable: false,
  retentionOffer: { pct: 50, boxes: 1, perUserOnce: true },
  extraAmountOptions: { kg: [0.25, 0.5, 1, 2], '500 g': [1, 2, 3], default: [1, 2, 3, 4] },
  deliveryWindow: '09:00–18:00',
  deliveryDatesHorizonWeeks: 8,
  dunning: { retryHours: [24, 72], pastDueAfterUnpaid: 2 },
  chargeStrategy: 'MERCHANT_INITIATED',
  paymentLinkHours: 20,
};

/** Setting `payment.iyzico` (gizli anahtarlar .env / panelden; burada yalnız bayraklar). */
export interface PaymentIyzicoSettings {
  enabled: boolean;
  /** iyzico saklı karttan NON3D (merchant-initiated) yetkisi yazılı teyit edildi mi (F11 kararı). */
  nonThreeDsGranted: boolean;
}

/** Setting `cookies.*`. */
export interface CookieSettings {
  analyticsEnabled: boolean;
}

/** Setting `seo.*` — sayfa başlıkları (anahtar = sayfa slug'ı). */
export type SeoSettings = Record<string, { title: string; description?: string }>;

/** Admin `POST /admin/settings/mail/test`. */
export interface MailTestRequest {
  to: string;
}

export interface SettingAuditRef {
  key: string;
  updatedBy?: Id | null;
  updatedAt: IsoDateTime;
}
