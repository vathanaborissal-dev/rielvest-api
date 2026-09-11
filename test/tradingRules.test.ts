import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bandPosition,
  isValidTick,
  orderSizing,
  priceBand,
  roundToTick,
  settlementDate,
  tickSizeFor,
} from '../src/analysis/tradingRules.ts';

describe('tickSizeFor', () => {
  it('applies the published bands', () => {
    assert.equal(tickSizeFor(1_380), 10);
    assert.equal(tickSizeFor(3_999), 10);
    assert.equal(tickSizeFor(4_000), 20);
    assert.equal(tickSizeFor(9_240), 20);
    assert.equal(tickSizeFor(19_999), 20);
    assert.equal(tickSizeFor(20_000), 50);
    assert.equal(tickSizeFor(40_000), 100);
    assert.equal(tickSizeFor(500_000), 1_000);
  });
});

describe('roundToTick', () => {
  it('snaps to the grid for the price band it lands in', () => {
    assert.equal(roundToTick(9_247), 9_240);
    assert.equal(roundToTick(1_384), 1_380);
  });

  it('rounds a buy limit down and a sell limit up so the order stays conservative', () => {
    assert.equal(roundToTick(9_247, 'down'), 9_240);
    assert.equal(roundToTick(9_247, 'up'), 9_260);
  });

  it('recognises prices already on the grid', () => {
    assert.equal(isValidTick(9_240), true);
    assert.equal(isValidTick(9_245), false);
  });
});

describe('priceBand', () => {
  it('gives a ±10% band snapped inward to valid ticks', () => {
    // ABC at 9,240: ±10% is 8,316 to 10,164, on a 20-riel tick.
    const band = priceBand(9_240);
    assert.equal(band.tickSize, 20);
    assert.equal(band.limitUp, 10_160); // 10,164 rounded down to the tick
    assert.equal(band.limitDown, 8_320); // 8,316 rounded up to the tick
  });

  it('uses the flat KHR 10 band below KHR 200', () => {
    const band = priceBand(150);
    assert.equal(band.allowedMove, 10);
    assert.equal(band.limitUp, 160);
    assert.equal(band.limitDown, 140);
    assert.match(band.method, /flat KHR 10/);
  });

  it('reports where a price sits inside the band', () => {
    const band = priceBand(10_000);
    assert.equal(bandPosition(band.limitDown, band), 0);
    assert.equal(bandPosition(band.limitUp, band), 100);
    assert.equal(Math.round(bandPosition(10_000, band)!), 50);
  });
});

describe('orderSizing', () => {
  it('translates typical turnover into a share count', () => {
    // 48 million riel a day, stock at 3,590.
    const sizing = orderSizing(48_000_000, 3_590);
    assert.equal(sizing.comfortableValue, 4_800_000);
    assert.equal(sizing.comfortableShares, 1_337);
    assert.match(sizing.note, /10% of a typical session/);
  });

  it('warns plainly when the stock barely trades', () => {
    const sizing = orderSizing(1_176_320, 2_180);
    assert.ok(sizing.comfortableShares < 100);
    assert.match(sizing.note, /almost any order sets the price/);
  });
});

describe('settlementDate', () => {
  it('is T+2 in business days', () => {
    // Monday trade settles Wednesday.
    assert.equal(settlementDate('2026-09-14'), '2026-09-16');
  });

  it('skips the weekend', () => {
    // Thursday trade settles Monday.
    assert.equal(settlementDate('2026-09-10'), '2026-09-14');
    // Friday trade settles Tuesday.
    assert.equal(settlementDate('2026-09-11'), '2026-09-15');
  });
});
