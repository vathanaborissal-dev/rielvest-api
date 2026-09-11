import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectNumbers, guardNumbers } from '../src/ai/numberGuard.ts';

/**
 * The guard is the only thing standing between a language model and a
 * fabricated figure on a page about money, so these cover both directions:
 * legitimate rewording must pass, and any invented quantity must fail.
 */

const source = {
  symbol: 'ABC',
  asOf: '2026-09-11',
  close: 9240,
  changePercent: 1.0940919037199124,
  pe: 4.75,
  pb: 0.59,
  volume: 149_237,
  marketCap: 3_240_059_380_000,
  support: { label: '50-day average', price: 7840 },
};

describe('collectNumbers', () => {
  it('reaches numbers at any depth, including inside strings', () => {
    const found = collectNumbers(source);
    assert.ok(found.has(9240));
    assert.ok(found.has(4.75));
    assert.ok(found.has(7840));
    // From the date string.
    assert.ok(found.has(2026));
    // From the label.
    assert.ok(found.has(50));
  });
});

describe('guardNumbers — legitimate rewording passes', () => {
  it('accepts figures copied exactly', () => {
    const text = 'ABC closed at 9,240 riel on 2026-09-11, up 1.09%.';
    assert.equal(guardNumbers(text, source).ok, true);
  });

  it('accepts sensible rounding of a long decimal', () => {
    assert.equal(guardNumbers('The shares rose 1.1% on the session.', source).ok, true);
    assert.equal(guardNumbers('The shares rose about 1%.', source).ok, true);
  });

  it('accepts a large figure written in millions or billions', () => {
    const text = 'Market capitalisation stands near 3,240 billion riel.';
    assert.equal(guardNumbers(text, source).ok, true);
  });

  it('accepts a sign flip on a magnitude already present', () => {
    assert.equal(guardNumbers('It sits 1.09% above the previous close.', source).ok, true);
  });

  it('accepts prose with no numbers at all', () => {
    assert.equal(guardNumbers('Trading was quiet and the tone unchanged.', source).ok, true);
  });
});

describe('guardNumbers — invented figures fail', () => {
  it('rejects a price that was never supplied', () => {
    const result = guardNumbers('ABC closed at 9,340 riel.', source);
    assert.equal(result.ok, false);
    assert.deepEqual(result.unsupported, [9340]);
  });

  it('rejects a transposed digit, which is the realistic failure', () => {
    const result = guardNumbers('The P/E is 4.57 times earnings.', source);
    assert.equal(result.ok, false);
    assert.deepEqual(result.unsupported, [4.57]);
  });

  it('rejects a plausible but unsourced derived statistic', () => {
    // Nothing in the source says anything about a 12-month return.
    const result = guardNumbers('ABC has returned 34% over the past year.', source);
    assert.equal(result.ok, false);
    assert.ok(result.unsupported.includes(34));
  });

  it('rejects an invented figure even when the rest of the passage is correct', () => {
    const text = 'ABC closed at 9,240 riel on 2026-09-11, with a dividend yield of 6.2%.';
    const result = guardNumbers(text, source);
    assert.equal(result.ok, false);
    assert.deepEqual(result.unsupported, [6.2]);
  });

  it('reports how many numbers it inspected', () => {
    const result = guardNumbers('9,240 riel, P/E 4.75, invented 8,888.', source);
    assert.equal(result.checked, 3);
    assert.deepEqual(result.unsupported, [8888]);
  });
});
