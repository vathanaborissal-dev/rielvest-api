import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDecisionReview } from '../src/analysis/decisionReview.ts';
import { averageTurnover } from '../src/analysis/liquidity.ts';
import type { StockAnalysis } from '../src/analysis/types.ts';
import type { TradePlan } from '../src/analysis/tradePlan.ts';

const analysis: StockAnalysis = {
  symbol: 'ABC', name: 'Fixture', asOf: '2026-09-11', score: 70,
  assessment: 'positive', coverage: 67, categories: [], risks: [],
  opportunities: [{ statement: 'Valuation below peers.', assessment: 'positive', basis: ['pe'] }],
  narrative: ['Fixture summary.'], dataGaps: ['Cash flow unavailable.'], methodology: '',
};
const plan: TradePlan = {
  symbol: 'ABC', asOf: '2026-09-11', lastPrice: 9240, dailyRange: null, zones: [],
  rules: { limitDown: 8320, limitUp: 10160, tickSize: 20, settlementDate: '2026-09-15',
    workableShares: 500, workableValue: 4_620_000, liquidityNote: '' },
  summary: [], caveats: [], caution: '',
};
const review = (a = analysis, p = plan) => buildDecisionReview(a, p, [], '2026-09-11');

describe('decision review', () => {
  it('allows further research while preserving missing evidence', () => {
    const result = review();
    assert.equal(result.stance, 'research');
    assert.deepEqual(result.gaps, analysis.dataGaps);
    assert.equal(result.summary.source, 'engine');
  });
  it('does not turn a high score with low coverage into a positive decision', () => {
    assert.equal(review({ ...analysis, score: 99, coverage: 33 }).stance, 'insufficient_data');
  });
  it('blocks stale, missing and mismatched sessions', () => {
    for (const asOf of ['2026-08-01', null]) assert.equal(review({ ...analysis, asOf }).stance, 'insufficient_data');
    assert.equal(review(analysis, { ...plan, asOf: '2026-09-10' }).stance, 'insufficient_data');
  });
  it('requires liquidity and surfaces serious risks despite a positive score', () => {
    assert.equal(review(analysis, { ...plan, rules: { ...plan.rules!, workableValue: 1000 } }).stance, 'wait');
    assert.equal(review({ ...analysis, risks: [{ statement: 'Losses', assessment: 'risk', basis: [] }] }).stance, 'wait');
    assert.equal(review(analysis, { ...plan, rules: null }).stance, 'insufficient_data');
  });
  it('flags same-day filings because their publication time is unknown', () => {
    const result = buildDecisionReview(analysis, plan, [{ title: 'Results', date: '2026-09-11', url: null }], '2026-09-11');
    assert.equal(result.stance, 'wait');
    assert.match(result.nextCheck, /filing/);
    assert.match(result.cautions[0]!, /timing/);
  });
  it('does not describe an old filing as unpriced news', () => {
    assert.equal(buildDecisionReview(analysis, plan, [{ title: 'Results', date: '2026-09-01', url: null }], '2026-09-11').stance, 'research');
  });
});

describe('turnover used for screening and sizing', () => {
  it('counts zero-trade sessions instead of averaging only active days', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ value: i === 19 ? 100_000_000 : 0 }));
    assert.equal(averageTurnover(bars), 5_000_000);
  });
  it('does not invent liquidity from incomplete or invalid observations', () => {
    assert.equal(averageTurnover([{ value: 100_000_000 }]), null);
    for (const value of [null, NaN, Infinity, -1]) {
      assert.equal(averageTurnover(Array.from({ length: 20 }, () => ({ value }))), null);
    }
  });
  it('ignores observations outside the latest twenty sessions', () => {
    assert.equal(averageTurnover([{ value: null }, ...Array.from({ length: 20 }, () => ({ value: 10 }))]), 10);
  });
});
