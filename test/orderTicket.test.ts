import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auctionGuidance, buildOrderTicket } from '../src/analysis/orderTicket.ts';
import { buildTradePlan } from '../src/analysis/tradePlan.ts';

/**
 * These use ACLEDA's real figures from the 2026-09-11 session: a 9,240 close,
 * which gives a 8,320–10,160 band on a 20 riel tick, and a support zone the
 * analysis puts at 7,840 — below the floor, and therefore not a price anyone
 * could trade at that day.
 */
describe('order tickets', () => {
  const base = { basePrice: 9_240, typicalDailyValue: 2_677_000_000, tradeDate: '2026-09-11' };

  it('turns a reachable level into a tick-valid limit price', () => {
    const ticket = buildOrderTicket({ ...base, side: 'buy', label: 'First support', targetPrice: 8_500 });
    assert.equal(ticket.reachableToday, true);
    assert.equal(ticket.limitPrice, 8_500);
    assert.equal(ticket.limitPrice! % ticket.tickSize, 0);
    assert.equal(ticket.unreachableNote, null);
  });

  it('refuses a level the daily band cannot reach', () => {
    const ticket = buildOrderTicket({ ...base, side: 'buy', label: 'Support zone', targetPrice: 7_840 });
    assert.equal(ticket.reachableToday, false);
    assert.equal(ticket.limitPrice, null, 'no limit price should be offered');
    assert.equal(ticket.shares, null);
    assert.match(ticket.unreachableNote ?? '', /below today's floor of 8,320/);
  });

  it('refuses a sell target above the ceiling', () => {
    const ticket = buildOrderTicket({ ...base, side: 'sell', label: '52-week high', targetPrice: 10_400 });
    assert.equal(ticket.reachableToday, false);
    assert.match(ticket.unreachableNote ?? '', /above today's ceiling of 10,160/);
  });

  it('rounds a buy down and a sell up, never against the trader', () => {
    // 8,505 is not on the 20 riel grid.
    const buy = buildOrderTicket({ ...base, side: 'buy', label: 'x', targetPrice: 8_505 });
    const sell = buildOrderTicket({ ...base, side: 'sell', label: 'x', targetPrice: 9_505 });
    assert.equal(buy.limitPrice, 8_500, 'a buy rounds down');
    assert.equal(sell.limitPrice, 9_520, 'a sell rounds up');
    assert.equal(buy.tickAdjustment, 5);
  });

  it('reports the band edges so an order can be checked before sending', () => {
    const ticket = buildOrderTicket({ ...base, side: 'buy', label: 'x', targetPrice: 9_000 });
    assert.equal(ticket.bandFloor, 8_320);
    assert.equal(ticket.bandCeiling, 10_160);
    assert.equal(ticket.tickSize, 20);
  });

  it('sizes the order and values it at the limit price', () => {
    const ticket = buildOrderTicket({ ...base, side: 'buy', label: 'x', targetPrice: 9_000 });
    assert.ok(ticket.shares! > 0);
    assert.equal(ticket.valueKhr, Math.round(ticket.shares! * ticket.limitPrice!));
  });

  it('settles T+2', () => {
    const ticket = buildOrderTicket({ ...base, side: 'buy', label: 'x', targetPrice: 9_000 });
    assert.equal(ticket.settlesOn, '2026-09-15'); // Fri 11th -> Tue 15th
  });

  it('leaves size unstated rather than guessing when turnover is unknown', () => {
    const ticket = buildOrderTicket({
      side: 'buy', label: 'x', targetPrice: 9_000, basePrice: 9_240, typicalDailyValue: null,
    });
    assert.equal(ticket.shares, null);
    assert.equal(ticket.valueKhr, null);
  });
});

describe('auction guidance', () => {
  it('explains single-price matching before the open', () => {
    const lines = auctionGuidance('pre_open');
    assert.match(lines.join(' '), /one opening price/);
    assert.match(lines.join(' '), /fills at the opening price/);
    assert.match(lines.join(' '), /earlier order wins/);
  });

  it('says orders queue when the book is shut', () => {
    assert.match(auctionGuidance('closed').join(' '), /opens at 08:00 and prices at 09:00/);
  });
});

/**
 * The company page drew the same ladder as the briefing but without the band
 * check, so ACLEDA's support zone at 7,840–7,920 rendered as a price to act on
 * while today's floor was 8,320. Reachability is now decided once, in the plan.
 */
describe('plan zones know what today permits', () => {
  // ACLEDA's shape: a long quiet base, then a sharp run. That is what puts the
  // 50-day average and every swing low far below the current close — a smooth
  // drift keeps them inside the band and never exercises this at all.
  const bars = Array.from({ length: 260 }, (_, i) => {
    const close = i < 210 ? 7_000 + Math.sin(i / 7) * 120 : 7_000 + (i - 210) * 46;
    return {
      tradeDate: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
      open: close, high: close * 1.01, low: close * 0.99, close,
      volume: 100_000, value: close * 100_000,
    };
  });

  it('marks a zone below the daily floor as out of reach', () => {
    const plan = buildTradePlan('DRIFT', bars);
    assert.ok(plan.rules, 'expected exchange rules');
    const unreachable = plan.zones.filter((zone) => !zone.reachableToday);
    assert.ok(unreachable.length > 0, 'a far support zone should be unreachable');
    for (const zone of unreachable) {
      const high = Math.max(zone.from, zone.to ?? zone.from);
      const low = Math.min(zone.from, zone.to ?? zone.from);
      assert.ok(
        high < plan.rules!.limitDown || low > plan.rules!.limitUp,
        `${zone.label} was marked unreachable but sits inside the band`,
      );
    }
  });

  it('marks zones inside the band as reachable', () => {
    const plan = buildTradePlan('DRIFT', bars);
    for (const zone of plan.zones.filter((z) => z.reachableToday)) {
      const high = Math.max(zone.from, zone.to ?? zone.from);
      const low = Math.min(zone.from, zone.to ?? zone.from);
      assert.ok(high >= plan.rules!.limitDown && low <= plan.rules!.limitUp);
    }
  });

  it('carries the same ticket construction the briefing uses', () => {
    const plan = buildTradePlan('DRIFT', bars);
    assert.ok('buy' in plan.tickets && 'sell' in plan.tickets);
    for (const ticket of [plan.tickets.buy, plan.tickets.sell]) {
      if (!ticket) continue;
      assert.equal(ticket.reachableToday, true, 'a returned ticket is always reachable');
      assert.equal(ticket.limitPrice! % ticket.tickSize, 0, 'limit sits on the tick grid');
    }
  });

  it('sends recent closes for a trend shape', () => {
    assert.equal(buildTradePlan('DRIFT', bars).spark.length, 30);
  });
});
