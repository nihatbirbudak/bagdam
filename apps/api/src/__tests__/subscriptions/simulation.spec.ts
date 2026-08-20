// F7 DoD — 8 haftalık simülasyon: günlük adımlarla job'lar (`JobsService.runOnce(name, now)` — CronLog satırlarıyla):
// cycles:ensure · cycles:lock-and-charge · payments:retry · cycles:expire-payment-links · reminders:cutoff.
// Zaman sahte saatle değil, `now` parametresiyle ilerletilir (UTC anları; TZ'den bağımsız). Beklenti: her Pazartesi
// kesiminde bir cycle tahsil edilir (cycle#1 peşin → 0 TL), önde ufuk kadar SCHEDULED cycle durur.
import { addDays, BASE_MONDAY, createSubsApp, type SubsApp } from './harness';

jest.setTimeout(600_000);

const DAYS = 56;
const JOBS = ['cycles:ensure', 'cycles:lock-and-charge', 'payments:retry', 'cycles:expire-payment-links', 'reminders:cutoff'] as const;

describe('8 haftalık simülasyon (haftalık abonelik, saklı kart, günlük job adımları)', () => {
  let app: SubsApp;

  beforeAll(async () => {
    app = await createSubsApp();
  });

  afterAll(async () => {
    try {
      await app?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it("56 gün × 5 job: 8 CHARGED (1 peşin + 7 tahsilat), önde SCHEDULED cycle'lar, CronLog her koşuda", async () => {
    const fx = await app.createFixture({ templateWeeks: 20 });
    const timeline: Array<{ day: string; locked: number; charged: number; created: number }> = [];
    for (let d = 0; d < DAYS; d++) {
      const day = addDays(BASE_MONDAY, d);
      const now = new Date(`${day}T09:30:00.000Z`); // 12:30 Europe/Istanbul — Pazartesi kesimi (12:00) geçmiş
      let locked = 0;
      let charged = 0;
      let created = 0;
      for (const name of JOBS) {
        const r = await app.jobs.runOnce(name, now);
        expect(r.status).toBe('SUCCESS');
        expect(r.cronLogId).not.toBeNull();
        expect(r.errors).toBe(0);
        const details = (r.details ?? {}) as Record<string, number>;
        if (name === 'cycles:lock-and-charge') {
          locked += details.locked ?? 0;
          charged += details.charged ?? 0;
        }
        if (name === 'cycles:ensure') created += details.created ?? 0;
      }
      // Ops günü: o gün teslim edilecek CHARGED cycle'lar hazırlanır → yola çıkar → teslim edilir
      const due = (await app.cyclesOf(fx.subscriptionId)).filter((c) => c.status === 'CHARGED' && c.deliveryDate.date.toISOString().slice(0, 10) === day);
      for (const c of due) {
        for (const st of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) await app.cycles.adminSetStatus(c.id, st, { actor: 'OPS' }, new Date(`${day}T12:00:00.000Z`));
      }
      timeline.push({ day, locked, charged, created });
    }

    const cycles = await app.cyclesOf(fx.subscriptionId);
    const byStatus = cycles.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
    expect(byStatus.DELIVERED).toBe(8); // 03-02 … 04-20 tahsil edildi ve teslim edildi
    expect(byStatus.SCHEDULED).toBeGreaterThanOrEqual(1);
    expect(Object.keys(byStatus).sort()).toEqual(['DELIVERED', 'SCHEDULED']);
    const chargedDates = cycles.filter((c) => c.status === 'DELIVERED').map((c) => c.deliveryDate.date.toISOString().slice(0, 10));
    expect(chargedDates).toEqual(['2027-03-02', '2027-03-09', '2027-03-16', '2027-03-23', '2027-03-30', '2027-04-06', '2027-04-13', '2027-04-20']);
    // Önde duran SCHEDULED cycle'lar ufuk (8 hafta) içinde ve ardışık haftalar
    const scheduled = cycles.filter((c) => c.status === 'SCHEDULED').map((c) => c.deliveryDate.date.toISOString().slice(0, 10));
    expect(scheduled[0]).toBe('2027-04-27');
    expect(scheduled[scheduled.length - 1]! <= addDays(BASE_MONDAY, DAYS - 1 + 56)).toBe(true);
    expect(cycles.map((c) => c.cycleNo)).toEqual(cycles.map((_, i) => i + 1));

    // Siparişler / ödemeler: 7 tahsilat (cycle#1 peşin, DELTA yok)
    const orders = await app.prisma.order.findMany({ where: { subscriptionId: fx.subscriptionId, id: { not: fx.orderId } } });
    expect(orders).toHaveLength(7);
    expect(orders.every((o) => o.status === 'DELIVERED' && o.paidAt !== null && o.kind === 'SUBSCRIPTION' && Number(o.shippingFee) === 0)).toBe(true);
    // İlk 2 kutu %50: cycle#1 (checkout) + cycle#2 indirimli, sonrakiler tam fiyat
    const c2 = cycles.find((c) => c.cycleNo === 2)!;
    const c3 = cycles.find((c) => c.cycleNo === 3)!;
    expect(Number(c2.discount)).toBe(app.tierPrice / 2);
    expect(Number(c3.discount)).toBe(0);
    expect(Number(c2.total)).toBe(app.tierPrice / 2);
    expect(Number(c3.total)).toBe(app.tierPrice);
    const sub = await app.sub(fx.subscriptionId);
    expect(sub.discountBoxesLeft).toBe(0);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.failedCycles).toBe(0);
    expect(sub.nextDeliveryOn?.toISOString().slice(0, 10)).toBe('2027-04-27');
    const payments = await app.prisma.payment.findMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    expect(payments.filter((p) => p.kind === 'CYCLE_CHARGE' && p.status === 'SUCCEEDED')).toHaveLength(7);

    // Zaman çizelgesi: kilit yalnız Pazartesileri (d = 0, 7, 14, … 49)
    const lockDays = timeline.filter((t) => t.locked > 0).map((t) => t.day);
    expect(lockDays).toEqual([0, 7, 14, 21, 28, 35, 42, 49].map((d) => addDays(BASE_MONDAY, d)));
    expect(timeline.reduce((a, t) => a + t.charged, 0)).toBe(8);

    // CronLog: her koşu bir satır
    const logs = await app.prisma.cronLog.count({ where: { startedAt: { gte: new Date('2027-03-01T00:00:00Z'), lt: new Date('2027-05-01T00:00:00Z') }, status: 'SUCCESS' } });
    expect(logs).toBeGreaterThanOrEqual(DAYS * JOBS.length);
    // Bildirim stub'ı: tahsilat + kesim hatırlatmaları
    expect(app.notifier.recent({ event: 'cycle.charged', subscriptionId: fx.subscriptionId })).toHaveLength(7);
    expect(app.notifier.recent({ event: 'subscription.cutoff-reminder', subscriptionId: fx.subscriptionId }).length).toBeGreaterThanOrEqual(7);
    // Olay günlüğü tutarlı: her tahsilatta LOCKED + CHARGED
    const events = await app.events(fx.subscriptionId);
    expect(events.filter((e) => e.type === 'LOCKED')).toHaveLength(8);
    expect(events.filter((e) => e.type === 'CHARGED')).toHaveLength(8);
    expect(events.filter((e) => e.type === 'PAYMENT_FAILED')).toHaveLength(0);
  });
});
