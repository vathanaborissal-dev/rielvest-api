import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSessionTicket, typicalSessionRange } from '../src/analysis/sessionTicket.ts';
import type { Bar } from '../src/analysis/indicators.ts';

function bars(range = 200): Bar[] {
  return Array.from({ length: 21 }, (_, i) => ({
    tradeDate: `2026-08-${String(i + 1).padStart(2, '0')}`, close: 9240,
    open: 9240, high: 9240 + range / 2, low: 9240 - range / 2,
    volume: 1000, value: 9_240_000,
  }));
}
const base = { side: 'buy' as const, basePrice: 9240, typicalRange: 200, typicalDailyValue: 50_000_000 };

describe('near-term limit references', () => {
  it('replaces distant support with a small, explicitly calculated pullback', () => {
    const ticket = buildSessionTicket({ ...base, level: { price: 7850, label: '50-day average' } })!;
    assert.equal(ticket.limitPrice, 9140);
    assert.equal(ticket.distanceKhr, -100);
    assert.match(ticket.referenceBasis!, /not a tested support/);
  });
  it('rejects a distant level even when the exchange permits it', () => {
    assert.equal(buildSessionTicket({ ...base, level: { price: 8500, label: 'Old low' } })!.limitPrice, 9140);
  });
  it('keeps nearby support that fits the observed range', () => {
    const ticket = buildSessionTicket({ ...base, level: { price: 9100, label: 'Recent support' } })!;
    assert.equal(ticket.limitPrice, 9100);
    assert.equal(ticket.label, 'Recent support');
  });
  it('scales to the stock instead of assuming all names move 200 riel', () => {
    assert.equal(buildSessionTicket({ ...base, typicalRange: 1000, level: null })!.limitPrice, 8740);
  });
  it('rounds calculated scenarios toward the close without enlarging their distance', () => {
    assert.equal(buildSessionTicket({ ...base, typicalRange: 110, level: null })!.limitPrice, 9200);
    assert.equal(buildSessionTicket({ ...base, side: 'sell', typicalRange: 110, level: null })!.limitPrice, 9280);
  });
  it('does not invent an entry when movement is absent or too small for one tick', () => {
    for (const typicalRange of [null, 0, 10, NaN, Infinity]) {
      assert.equal(buildSessionTicket({ ...base, typicalRange, level: null }), null);
    }
  });
  it('retains exchange constraints and sizes at the revised limit price', () => {
    assert.equal(buildSessionTicket({ ...base, typicalRange: 10_000, level: null }), null);
    const ticket = buildSessionTicket({ ...base, level: null })!;
    assert.equal(ticket.valueKhr, ticket.shares! * ticket.limitPrice!);
    assert.ok(ticket.limitPrice! >= ticket.bandFloor);
  });
});

describe('recent typical range', () => {
  it('uses twenty full sessions and resists a single unusually large move', () => {
    const series = bars(); series[20]!.high = 12_000;
    assert.equal(typicalSessionRange(series), 200);
  });
  it('counts zero-range sessions instead of dropping quiet days', () => {
    assert.equal(typicalSessionRange(bars(0)), 0);
  });
  it('does not bridge missing or invalid bars', () => {
    assert.equal(typicalSessionRange(bars().slice(1)), null);
    const missing = bars(); missing[10]!.high = null;
    assert.equal(typicalSessionRange(missing), null);
    const invalid = bars(); invalid[10]!.low = 10_000;
    assert.equal(typicalSessionRange(invalid), null);
  });
});
