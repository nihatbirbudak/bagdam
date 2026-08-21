/**
 * Ekran 20 (Teslimat Günü — ops) saf yardımcıları — test edilir.
 *
 * Uçlar (F9/C):
 *   `GET  /admin/cycles?date&status&zone`     → AdminCycleListItem[]
 *   `GET  /admin/orders?deliveryOn&…`         → OrderSummary[]
 *   `GET  /admin/ops/pick-list?date&zone`     → PickListRow[]      (ürün bazında toplam + tercih dağılımı)
 *   `GET  /admin/ops/packing-list?date&zone`  → PackingListEntry[] (müşteri bazında fiş)
 *   `GET  /admin/ops/day-summary?date&zone`   → OpsDaySummary
 *   `POST /admin/ops/bulk-status`             → OpsBulkStatusResult
 *
 * Toplu durum: hedef yalnız `OPS_BULK_STATUS_VALUES` (PREPARING · OUT_FOR_DELIVERY · DELIVERED ·
 * DELIVERY_FAILED). `DELIVERY_FAILED` cycle makinesinde YOKTUR — cycleIds ile gönderilirse sunucu 409 verir;
 * bu yüzden panel her hedef için satırları kendi makinesine göre önceden süzer (`bulkApplicableIds`).
 */
import {
  CYCLE_STATUS_LABELS,
  OPS_BULK_STATUS_VALUES,
  ORDER_STATUS_LABELS,
  cycleMachine,
  orderMachine,
  type CycleStatus,
  type OpsBulkStatus,
  type OrderStatus,
} from '@bagdam/shared';
import type { PackingListEntry, PickListRow } from '../../lib/apiTypes';

/* ── Etiket ────────────────────────────────────────────────────────────── */

/** Cycle ya da sipariş durumunun Türkçe etiketi (ikisi de aynı ops akışında görünür). */
export function opsStatusLabel(status: string): string {
  return (
    (CYCLE_STATUS_LABELS as Record<string, string>)[status] ??
    (ORDER_STATUS_LABELS as Record<string, string>)[status] ??
    status
  );
}

/* ── Toplu durum ───────────────────────────────────────────────────────── */

export interface BulkRow {
  id: string;
  status: string;
}

export interface BulkSelection {
  cycles: readonly BulkRow[];
  orders: readonly BulkRow[];
}

export interface BulkOption {
  status: OpsBulkStatus;
  label: string;
  /** Hedefe geçebilecek satır sayıları (geçemeyenler gönderilmez). */
  cycles: number;
  orders: number;
  total: number;
}

function cycleCan(from: string, to: string): boolean {
  if (!(from in CYCLE_STATUS_LABELS) || !(to in CYCLE_STATUS_LABELS)) return false;
  return cycleMachine.canTransition(from as CycleStatus, to as CycleStatus);
}

function orderCan(from: string, to: string): boolean {
  if (!(from in ORDER_STATUS_LABELS) || !(to in ORDER_STATUS_LABELS)) return false;
  return orderMachine.canTransition(from as OrderStatus, to as OrderStatus);
}

/** Seçime uygulanabilir hedefler — hiçbir satır geçemiyorsa hedef listeye girmez. */
export function bulkStatusOptions(sel: BulkSelection): BulkOption[] {
  const out: BulkOption[] = [];
  for (const status of OPS_BULK_STATUS_VALUES) {
    const cycles = sel.cycles.filter((c) => cycleCan(c.status, status)).length;
    const orders = sel.orders.filter((o) => orderCan(o.status, status)).length;
    if (cycles + orders === 0) continue;
    out.push({ status, label: opsStatusLabel(status), cycles, orders, total: cycles + orders });
  }
  return out;
}

/** Hedefe gönderilecek kimlikler; geçemeyen satırlar istemcide elenir (sunucu ayrıca doğrular). */
export function bulkApplicableIds(sel: BulkSelection, status: string): { cycleIds: string[]; orderIds: string[] } {
  return {
    cycleIds: sel.cycles.filter((c) => cycleCan(c.status, status)).map((c) => c.id),
    orderIds: sel.orders.filter((o) => orderCan(o.status, status)).map((o) => o.id),
  };
}

/** Geri alınamaz hedef (teslim edilemedi) onay ister. */
export function bulkNeedsConfirm(status: string): boolean {
  return status === 'DELIVERY_FAILED';
}

/** Toplu sonuç → tek satır bildirim metni. */
export function bulkResultMessage(result: { updated: number; failed: number; skipped: number }): string {
  const parts = [`${result.updated} kayıt güncellendi`];
  if (result.skipped > 0) parts.push(`${result.skipped} atlandı`);
  if (result.failed > 0) parts.push(`${result.failed} başarısız`);
  return parts.join(', ');
}

/* ── Toplama listesi (pick) ────────────────────────────────────────────── */

export interface PickDigest {
  products: number;
  totalQty: number;
  boxQty: number;
  extraQty: number;
  boxes: number;
  extras: number;
}

export function summarizePickList(rows: readonly PickListRow[]): PickDigest {
  const d: PickDigest = { products: rows.length, totalQty: 0, boxQty: 0, extraQty: 0, boxes: 0, extras: 0 };
  for (const r of rows) {
    d.totalQty += Number(r.totalQty) || 0;
    d.boxQty += Number(r.boxQty) || 0;
    d.extraQty += Number(r.extraQty) || 0;
    d.boxes += Number(r.boxCount) || 0;
    d.extras += Number(r.extraCount) || 0;
  }
  d.totalQty = Math.round(d.totalQty * 1000) / 1000;
  d.boxQty = Math.round(d.boxQty * 1000) / 1000;
  d.extraQty = Math.round(d.extraQty * 1000) / 1000;
  return d;
}

/** Toplama listesi ürün adına göre (tr-TR) sıralanır — depoda okunması kolay olsun. */
export function sortPickList(rows: readonly PickListRow[]): PickListRow[] {
  return [...rows].sort((a, b) => a.productName.localeCompare(b.productName, 'tr'));
}

/** "3 kg" / "12" — birim yoksa yalnız sayı. */
export function qtyLabel(qty: number, unit: string | null | undefined): string {
  const n = Number(qty);
  const value = Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '—';
  return unit ? `${value} ${unit}` : value;
}

/** Tercih dağılımı metni: "çekirdeksiz ×3 · çekirdekli ×1"; tercih yoksa boş. */
export function prefsText(prefs: PickListRow['prefs'] | undefined): string {
  if (!prefs || prefs.length === 0) return '';
  return prefs.map((p) => `${p.pref} ×${p.count}`).join(' · ');
}

/* ── Paketleme listesi (packing) ──────────────────────────────────────── */

/** Fişler bölge → müşteri adına göre gruplanır (kurye sırası). */
export function groupPackingByZone(entries: readonly PackingListEntry[]): Array<{ zoneName: string; entries: PackingListEntry[] }> {
  const map = new Map<string, PackingListEntry[]>();
  for (const e of entries) {
    const key = e.zoneName || '—';
    const bucket = map.get(key);
    if (bucket) bucket.push(e);
    else map.set(key, [e]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
    .map(([zoneName, list]) => ({ zoneName, entries: [...list].sort((a, b) => a.customerName.localeCompare(b.customerName, 'tr')) }));
}

/** Fiş satırı metni: "Domates — 1 kg (çekirdeksiz)"; kaynak rozetini çağıran ekler. */
export function packingItemText(item: { name: string; label: string | null; pref: string | null }): string {
  const parts = [item.name];
  if (item.label) parts.push(`— ${item.label}`);
  if (item.pref) parts.push(`(${item.pref})`);
  return parts.join(' ');
}

/* ── Gün özeti (OpsDaySummary) yardımcıları ───────────────────────────── */

/** Özet şeridinde gösterilecek uyarılar (tahsilat sorunu, kesim bekleyen kutu, kapasitesi dolan bölge). */
export function daySummaryWarnings(summary: {
  unpaidCount: number;
  awaitingPaymentCount: number;
  cycleCountsByStatus: Partial<Record<string, number>>;
  zones: Array<{ zoneName: string; capacity: number | null; reserved: number | null; locked: boolean }>;
}): string[] {
  const warnings: string[] = [];
  if (summary.unpaidCount > 0) warnings.push(`${summary.unpaidCount} kutu tahsil edilemedi (UNPAID) — Ödeme Problemleri ekranına bakın.`);
  if (summary.awaitingPaymentCount > 0) warnings.push(`${summary.awaitingPaymentCount} kutu ödeme linki bekliyor.`);
  const locked = summary.cycleCountsByStatus.LOCKED ?? 0;
  if (locked > 0) warnings.push(`${locked} kutu kilitli ama henüz tahsil edilmedi.`);
  const scheduled = summary.cycleCountsByStatus.SCHEDULED ?? 0;
  if (scheduled > 0) warnings.push(`${scheduled} kutu hâlâ planlandı durumunda (kesim bekliyor).`);
  for (const z of summary.zones) {
    if (z.capacity !== null && z.reserved !== null && z.capacity > 0 && z.reserved >= z.capacity) {
      warnings.push(`${z.zoneName} bölgesi bu gün için dolu (${z.reserved}/${z.capacity}).`);
    }
  }
  return warnings;
}

/* ── Yazdırma ─────────────────────────────────────────────────────────── */

export type PrintKind = 'pick' | 'packing';

export const PRINT_KIND_LABELS: Record<PrintKind, string> = {
  pick: 'Toplama listesi',
  packing: 'Paketleme listesi',
};

/** Yazdırma sayfası başlığı: "Toplama listesi — 25.08.2026 · Urla". */
export function printTitle(kind: PrintKind, date: string, zoneName?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const human = m ? `${m[3]}.${m[2]}.${m[1]}` : date;
  return `${PRINT_KIND_LABELS[kind]} — ${human}${zoneName ? ` · ${zoneName}` : ''}`;
}
