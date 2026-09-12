import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cached, clearLiveCache } from '../src/live/cache.ts';

/**
 * The live layer borrows numbers from other people's servers and shows them
 * beside RielVest's own. The failure that matters is not an outage — it is a
 * plausible figure that is months old, or a change computed against the wrong
 * baseline. Both have already happened against real responses:
 *
 *  - Hang Seng read -3.3% from `meta.chartPreviousClose` against an actual
 *    -0.6%, because that field holds the close before a multi-day window.
 *  - Yahoo's daily series for ^SET.BK stops in mid-July while its metadata
 *    reports a September session.
 */

/** The series maths, mirrored from fetchYahooQuote so it can be tested alone. */
function changeFromCloses(points: Array<{ close: number; at: number }>): number | null {
  if (points.length < 2) return null;
  const last = points.at(-1)!;
  const previous = points.at(-2)!;
  return previous.close === 0 ? null : (last.close / previous.close - 1) * 100;
}

describe('live series maths', () => {
  it('computes the change from the last two closes, not the window baseline', () => {
    // Real Hang Seng closes, 7–11 Sep 2026.
    const closes = [25413.12, 25317.18, 25274.96, 24954.47, 24805.63];
    const points = closes.map((close, i) => ({ close, at: 1_757_000_000 + i * 86_400 }));
    assert.equal(Number(changeFromCloses(points)!.toFixed(2)), -0.6);

    // What chartPreviousClose would have produced from the same response.
    const wrong = (closes.at(-1)! / 25650.87 - 1) * 100;
    assert.ok(Math.abs(wrong) > 3, 'the discarded baseline really is far off');
  });

  it('cannot form a change from a single session', () => {
    assert.equal(changeFromCloses([{ close: 1604.52, at: 1_757_000_000 }]), null);
  });
});

describe('live cache', () => {
  it('calls the loader once inside the window, then again after it', async () => {
    clearLiveCache();
    let calls = 0;
    const load = async () => { calls += 1; return calls; };

    assert.equal(await cached('k', 60, load), 1);
    assert.equal(await cached('k', 60, load), 1, 'second read is served from memory');
    assert.equal(calls, 1);

    clearLiveCache();
    assert.equal(await cached('k', 60, load), 2, 'a cleared cache refetches');
  });

  it('keeps separate keys apart', async () => {
    clearLiveCache();
    assert.equal(await cached('a', 60, async () => 'A'), 'A');
    assert.equal(await cached('b', 60, async () => 'B'), 'B');
    assert.equal(await cached('a', 60, async () => 'changed'), 'A');
  });

  it('expires an entry once its ttl has passed', async () => {
    clearLiveCache();
    let calls = 0;
    const load = async () => { calls += 1; return calls; };
    await cached('short', 0, load);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await cached('short', 0, load);
    assert.equal(calls, 2);
  });
});
