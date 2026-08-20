/**
 * OrdersModule sabitleri (F7/B2). Hata kodları shared `OrdersErrorCode` ile aynı metinlerdir; burada yalnız api içi kullanım.
 */

/** Admin liste varsayılan sayfalama. */
export const ORDERS_DEFAULT_PAGE = 1;
export const ORDERS_DEFAULT_LIMIT = 25;
/** `GET /me/orders` sayfa boyutu (müşteri listesi; F9 "siparişlerim" kartı). */
export const ME_ORDERS_LIMIT = 50;
/** CSV dışa aktarım üst sınırı (satır) — tüm tabloyu belleğe çekmesin. */
export const ORDERS_CSV_MAX_ROWS = 10_000;

/** Admin not ekleme zaman damgası biçimi (Europe/Istanbul). */
export const ADMIN_NOTE_STAMP_FORMAT = 'yyyy-MM-dd HH:mm';
/** Order.adminNote üst sınırı — sınırsız text kolon, yine de birikmesin. */
export const ADMIN_NOTE_MAX_LENGTH = 8000;

/**
 * `GET /admin/orders/export.csv` sütunları — sıra sabittir (muhasebe/Excel içe aktarımı buna göre eşlenir; test başlığı doğrular).
 * Tutarlar nokta ondalıklı (makine biçimi), anlar ISO 8601 UTC, deliveryOn takvim günü.
 */
export const ORDER_CSV_COLUMNS = [
  'orderNo',
  'createdAt',
  'status',
  'kind',
  'customerName',
  'customerEmail',
  'customerPhone',
  'zone',
  'deliveryDay',
  'deliveryOn',
  'subtotal',
  'discountTotal',
  'shippingFee',
  'vatTotal',
  'grandTotal',
  'paidAt',
  'invoiceNo',
  'couponCode',
  'lineCount',
] as const;
export type OrderCsvColumn = (typeof ORDER_CSV_COLUMNS)[number];

/** CSV: UTF-8 BOM (Excel Türkçe karakterleri doğru açsın) + CRLF + virgül ayırıcı (RFC 4180). */
export const CSV_BOM = String.fromCharCode(0xfeff);
export const CSV_EOL = '\r\n';
export const CSV_SEPARATOR = ',';

/** Müşteri iptal nedeni üst sınırı (Order.cancelReason VarChar(200)). */
export const ORDER_CANCEL_REASON_MAX = 200;
/** Müşteri iptalinde neden verilmezse yazılan metin. */
export const ORDER_CUSTOMER_CANCEL_DEFAULT_REASON = 'Müşteri iptali';
