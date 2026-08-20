/**
 * PayTR API istek/yanıt tipleri (https://dev.paytr.com). Yalnız tip + uç nokta sabitleri; mantık PayTrProvider'da.
 * Para birimi TL; iFrame/Link tutarları kuruş (int), Direkt/kayıtlı kart/iade tutarları "123.45" ondalık metin.
 */

export const PAYTR_ENDPOINTS = {
  /** iFrame API 1. adım — token. */
  getToken: 'https://www.paytr.com/odeme/api/get-token',
  /** iFrame sayfası — `<iframe src="…/<token>">` ya da 302 hedefi. */
  iframeBase: 'https://www.paytr.com/odeme/guvenli/',
  /** iFrame yeniden boyutlandırma betiği (checkoutFormContent içinde). */
  iframeResizer: 'https://www.paytr.com/js/iframeResizer.min.js',
  /** Direkt API / kayıtlı karttan ödeme / tekrarlayan ödeme. */
  directPayment: 'https://www.paytr.com/odeme',
  statusQuery: 'https://www.paytr.com/odeme/durum-sorgu',
  refund: 'https://www.paytr.com/odeme/iade',
  linkCreate: 'https://www.paytr.com/odeme/api/link/create',
  linkDelete: 'https://www.paytr.com/odeme/api/link/delete',
  capiList: 'https://www.paytr.com/odeme/capi/list',
  capiDelete: 'https://www.paytr.com/odeme/capi/delete',
} as const;

/** PayTR bildirim (callback) yanıtları — düz metin. */
export const PAYTR_CALLBACK_OK = 'OK';
export const PAYTR_CALLBACK_BAD_HASH = 'PAYTR notification failed: bad hash';
export const PAYTR_CALLBACK_IP_REJECTED = 'PAYTR notification failed: ip not allowed';
export const PAYTR_CALLBACK_MISSING_FIELDS = 'PAYTR notification failed: missing fields';
export const PAYTR_CALLBACK_NOT_CONFIGURED = 'PAYTR notification failed: not configured';
export const PAYTR_CALLBACK_PROCESSING_ERROR = 'PAYTR notification failed: processing error';

/** WebhookEvent.eventType (PAYTR bildirimi). */
export const PAYTR_CALLBACK_EVENT_TYPE = 'callback';

/** iFrame get-token yanıtı. */
export interface PayTrTokenResponse {
  status: 'success' | 'failed';
  token?: string;
  reason?: string;
}

/** Bildirim (callback) gövdesi — form-urlencoded; iFrame/Direkt + Link API (callback_id) + kayıtlı kart (utoken/ctoken) alanları. */
export interface PayTrCallbackPayload {
  merchant_oid: string;
  status: 'success' | 'failed' | string;
  /** Tahsil edilen tutar ×100 (taksit komisyonu dahil olabilir); başarısızda 0. */
  total_amount: string;
  hash: string;
  /** 1. adımdaki payment_amount (×100) — tutar karşılaştırması bununla. */
  payment_amount?: string;
  payment_type?: 'card' | 'eft' | string;
  currency?: string;
  test_mode?: string;
  failed_reason_code?: string;
  failed_reason_msg?: string;
  installment_count?: string;
  /** Link API bildirimi: link oluşturmada verdiğimiz callback_id (= merchant_oid eşlemesi). */
  callback_id?: string;
  merchant_id?: string;
  /** Kart saklama (store_card=1): kullanıcı/kart token'ları. */
  utoken?: string;
  ctoken?: string;
  /** Kart özeti (PayTR dokümantasyon dışı/opsiyonel alanlar — varsa PaymentMethod'a yazılır). */
  card_type?: string;
  masked_pan?: string;
  kart_marka?: string;
  last_4?: string;
  [key: string]: string | undefined;
}

/** Durum Sorgu yanıtı. */
export interface PayTrStatusResponse {
  status: 'success' | 'error';
  payment_amount?: string;
  payment_total?: string;
  payment_date?: string;
  currency?: string;
  taksit?: string;
  kart_marka?: string;
  masked_pan?: string;
  odeme_tipi?: string;
  test_mode?: string;
  returns?: Array<Record<string, unknown>>;
  err_no?: string;
  err_msg?: string;
}

/** İade yanıtı. */
export interface PayTrRefundResponse {
  status: 'success' | 'error';
  is_test?: string | number;
  merchant_oid?: string;
  return_amount?: string;
  reference_no?: string;
  err_no?: string;
  err_msg?: string;
}

/** Link API create yanıtı. */
export interface PayTrLinkCreateResponse {
  status: 'success' | 'error' | 'failed';
  id?: string;
  link?: string;
  qr?: string;
  reason?: string;
  err_msg?: string;
}

/** Link API delete yanıtı. */
export interface PayTrLinkDeleteResponse {
  status: 'success' | 'error' | 'failed';
  reason?: string;
  err_msg?: string;
  success_deletes?: string[];
  failed_deletes?: string[];
}

/** Kayıtlı kart tekrarlayan ödeme (recurring_payment=1, non_3d=1) — eşzamanlı JSON yanıtı. */
export interface PayTrRecurringResponse {
  status: 'success' | 'failed' | 'wait_callback' | string;
  msg?: string;
  try_again?: boolean | string;
  err_no?: string;
  err_msg?: string;
  reason?: string;
}

/** capi/list kart satırı. */
export interface PayTrStoredCard {
  ctoken: string;
  last_4: string;
  month?: string;
  year?: string;
  c_bank?: string;
  c_brand?: string;
  c_type?: string;
  c_name?: string;
  require_cvv?: string;
  schema?: string;
  initial?: string;
  businessCard?: string;
}
