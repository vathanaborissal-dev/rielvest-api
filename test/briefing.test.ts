import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { priceBand, roundToTick } from '../src/analysis/tradingRules.ts';
import { buildPriceLevels } from '../src/analysis/levels.ts';
import type { Bar } from '../src/analysis/indicators.ts';
import { getMarketStatus } from '../src/modules/market/market.status.ts';
import {
  MAX_SHARE_OF_TURNOVER,
  MIN_DAILY_VALUE_KHR,
  REFERENCE_POSITION_KHR,
  buildFreshness,
  isTradeable,
} from '../src/modules/market/market.digest.ts';

/**
 * The brief's value depends on ranking, not on having many signals. These
 * cover the parts that decide what a reader sees first.
 */

/** A synthetic series that rises steadily then jumps on the final session. */
function series(closes: number[]): Bar[] {
  return closes.map((close, index) => ({
    tradeDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1_000,
    value: close * 1_000,
  }));
}

describe('price levels feed the brief', () => {
  it('separates pivots from levels the market has actually respected', () => {
    const bars = series(Array.from({ length: 120 }, (_, i) => 1_000 + Math.sin(i / 4) * 50));
    const levels = buildPriceLevels('TEST', bars);

    const pivots = levels.levels.filter((level) => level.origin === 'pivot');
    const structural = levels.levels.filter((level) => level.origin === 'structural');

    assert.ok(pivots.length > 0, 'expected pivot levels');
    assert.ok(structural.length > 0, 'expected structural levels');
    // The nearest structural level must not be a pivot, which by construction
    // always sits within a fraction of a percent of the close.
    assert.notEqual(levels.nearestStructuralResistance?.origin, 'pivot');
  });

  it('counts how often a swing level has been tested', () => {
    // An oscillation repeatedly turns at the same highs and lows.
    const bars = series(Array.from({ length: 150 }, (_, i) => 1_000 + (i % 10 < 5 ? 40 : -40)));
    const levels = buildPriceLevels('TEST', bars);
    const swing = levels.levels.find((level) => level.label.startsWith('Prior'));
    assert.ok(swing);
    assert.ok(swing.touches >= 1);
  });

  it('reports honestly when there is not enough history', () => {
    const levels = buildPriceLevels('TEST', series([1_000]));
    assert.equal(levels.levels.length, 0);
    assert.match(levels.summary[0]!, /Not enough recorded sessions/);
  });
});

describe('key prices are tradable', () => {
  it('keeps the daily band inside what the exchange will accept', () => {
    const band = priceBand(15_460);
    // Both ends must sit on the tick grid, or an order naming them is rejected.
    assert.equal(band.limitUp % band.tickSize, 0);
    assert.equal(band.limitDown % band.tickSize, 0);
    // And inside the ±10% rule, never beyond it.
    assert.ok(band.limitUp <= 15_460 * 1.1);
    assert.ok(band.limitDown >= 15_460 * 0.9);
  });

  it('rounds a level onto the grid without crossing it', () => {
    // A support reference rounds down so it is never quoted tighter than it is.
    assert.ok(roundToTick(14_091, 'down') <= 14_091);
    // A resistance reference rounds up for the same reason.
    assert.ok(roundToTick(15_477, 'up') >= 15_477);
  });
});

/**
 * The liquidity gate.
 *
 * An earlier shortlist scored liquidity as a bonus worth twelve points out of
 * about a hundred, which let the three thinnest counters on CSX outrank ACLEDA
 * — they won *because* they are illiquid, since a price that barely moves sits
 * permanently beside its own prior low and the proximity term rewards that.
 * These figures are real 20-day turnover from the exchange.
 */
describe('the tradeable gate', () => {
  it('is derived from a position size, not picked', () => {
    assert.equal(MIN_DAILY_VALUE_KHR, REFERENCE_POSITION_KHR / MAX_SHARE_OF_TURNOVER);
    // A reference position must stay under a fifth of a normal day.
    assert.ok(REFERENCE_POSITION_KHR / MIN_DAILY_VALUE_KHR <= MAX_SHARE_OF_TURNOVER);
  });

  it('admits the stocks CSX actually trades', () => {
    for (const [symbol, turnover] of [
      ['ABC', 2_677_000_000],
      ['PPSP', 302_000_000],
      ['PPAP', 137_000_000],
      ['MJQE', 77_000_000],
    ] as const) {
      assert.ok(isTradeable(turnover), `${symbol} should be tradeable`);
    }
  });

  it('excludes the counters that produced the old shortlist', () => {
    for (const [symbol, turnover] of [
      ['PCG', 15_000_000],
      ['JSL', 14_000_000],
      ['GTI', 13_000_000],
      ['PEPC', 12_000_000],
      ['DBDE', 12_000_000],
    ] as const) {
      assert.ok(!isTradeable(turnover), `${symbol} should be excluded`);
    }
  });

  it('treats missing turnover as untradeable rather than as zero risk', () => {
    assert.equal(isTradeable(null), false);
    assert.equal(isTradeable(0), false);
  });

  it('rejects a turnover that only just misses, without rounding it up', () => {
    assert.equal(isTradeable(MIN_DAILY_VALUE_KHR - 1), false);
    assert.equal(isTradeable(MIN_DAILY_VALUE_KHR), true);
  });
});

/**
 * Naming the session.
 *
 * The wall clock and the newest session date move independently: at 08:30 on a
 * Monday the freshest data is Friday's, and the page used to head that "Today in
 * 30 seconds". These pin the heading to the clock in every phase.
 */
describe('freshness naming', () => {
  const FRIDAY = '2026-09-11';
  const at = (iso: string, asOf: string | null = FRIDAY) => {
    const now = new Date(iso);
    return buildFreshness(asOf, getMarketStatus(now), now);
  };

  it('calls a completed session today "today"', () => {
    const f = at('2026-09-11T08:10:00Z'); // Fri 15:10 ICT, just closed
    assert.equal(f.eyebrow, 'After the close');
    assert.equal(f.isCurrentSession, true);
    assert.equal(f.staleNote, null);
  });

  it('never presents the previous session as today', () => {
    // Mon 08:30 ICT — pre-opening auction, newest data still Friday's.
    const f = at('2026-09-14T01:30:00Z');
    assert.equal(f.isCurrentSession, false);
    assert.equal(f.eyebrow, 'Before the bell');
    assert.match(f.kicker, /Friday/);
    assert.ok(f.staleNote?.includes('09:00'), 'should say when trading starts');
    assert.ok(!/today in 30 seconds/i.test(f.kicker));
  });

  it('warns that figures lag while the market is trading', () => {
    const f = at('2026-09-14T05:00:00Z'); // Mon 12:00 ICT
    assert.equal(f.eyebrow, 'Market open');
    assert.match(f.staleNote ?? '', /update after the 15:00 close/);
  });

  it('marks live figures as still moving once today has data', () => {
    const f = at('2026-09-14T05:00:00Z', '2026-09-14');
    assert.equal(f.isCurrentSession, true);
    assert.equal(f.kicker, 'So far today');
    assert.match(f.staleNote ?? '', /move until the 15:00 close/);
  });

  it('says the market is shut at the weekend', () => {
    for (const iso of ['2026-09-12T04:00:00Z', '2026-09-13T12:00:00Z']) {
      const f = at(iso);
      assert.equal(f.eyebrow, 'Markets closed');
      assert.equal(f.isCurrentSession, false);
      assert.match(f.staleNote ?? '', /Monday 09:00/);
    }
  });

  it('does not invent a session when none has been recorded', () => {
    const f = at('2026-09-14T01:30:00Z', null);
    assert.equal(f.sessionDate, null);
    assert.equal(f.eyebrow, 'No data yet');
    assert.match(f.staleNote ?? '', /No trading session/);
  });
});
