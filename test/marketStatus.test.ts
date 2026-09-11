import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMarketStatus } from '../src/modules/market/market.status.ts';

/**
 * Times are given as UTC instants; Cambodia is a fixed UTC+7, so 02:00 UTC is
 * 09:00 in Phnom Penh.
 */
const at = (iso: string) => getMarketStatus(new Date(iso));

describe('getMarketStatus', () => {
  it('is open during continuous trading on a weekday', () => {
    // Friday 2026-09-11, 03:00 UTC = 10:00 ICT
    const status = at('2026-09-11T03:00:00Z');
    assert.equal(status.phase, 'open');
    assert.equal(status.isOpen, true);
    assert.equal(status.acceptsOrders, true);
    assert.equal(status.localTime, '10:00');
    assert.equal(status.nextOpen, null);
  });

  it('reports the pre-opening auction before 09:00', () => {
    // Friday 01:30 UTC = 08:30 ICT
    const status = at('2026-09-11T01:30:00Z');
    assert.equal(status.phase, 'pre_open');
    assert.equal(status.isOpen, false);
    assert.match(status.label, /Pre-opening auction/);
  });

  it('runs the closing auction between 14:50 and 15:00', () => {
    // Friday 07:55 UTC = 14:55 ICT
    const status = at('2026-09-11T07:55:00Z');
    assert.equal(status.phase, 'closing_auction');
    assert.equal(status.isOpen, false);
    assert.equal(status.acceptsOrders, true);
    assert.match(status.label, /Closing auction/);
  });

  it('is closed after the 15:00 bell and points at the next session', () => {
    // Friday 08:05 UTC = 15:05 ICT — the case that showed "waiting" forever.
    const status = at('2026-09-11T08:05:00Z');
    assert.equal(status.phase, 'closed');
    assert.equal(status.isOpen, false);
    assert.equal(status.acceptsOrders, false);
    assert.match(status.label, /today's session ended at 15:00/);
    // Next open is Monday, since Friday's has passed.
    assert.equal(status.nextOpen, '2026-09-14T02:00:00.000Z');
  });

  it('closes for the weekend and reopens on Monday', () => {
    // Saturday 2026-09-12, 03:00 UTC = 10:00 ICT
    const status = at('2026-09-12T03:00:00Z');
    assert.equal(status.phase, 'weekend');
    assert.match(status.label, /weekend/);
    assert.equal(status.nextOpen, '2026-09-14T02:00:00.000Z');
  });

  it('treats the session boundaries as inclusive and exclusive', () => {
    // 02:00 UTC = 09:00 ICT exactly — continuous trading begins.
    assert.equal(at('2026-09-11T02:00:00Z').phase, 'open');
    // 07:50 UTC = 14:50 ICT exactly — continuous trading ends.
    assert.equal(at('2026-09-11T07:50:00Z').phase, 'closing_auction');
    // 08:00 UTC = 15:00 ICT exactly — closed.
    assert.equal(at('2026-09-11T08:00:00Z').phase, 'closed');
  });

  it('points at the same day when the session has not started yet', () => {
    // Monday 2026-09-14, 00:00 UTC = 07:00 ICT, before pre-open.
    const status = at('2026-09-14T00:00:00Z');
    assert.equal(status.phase, 'closed');
    assert.equal(status.nextOpen, '2026-09-14T02:00:00.000Z');
  });
});
