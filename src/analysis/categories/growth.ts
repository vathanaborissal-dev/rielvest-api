import { pctChange, round } from '../../core/num.ts';
import type { AnalysisInput } from '../inputs.ts';
import { assessmentForScore, averageScore, scoreWithBands, toScale, type Band } from '../scoring.ts';
import type { Category, Finding, Metric } from '../types.ts';

const SERC_SOURCE = { code: 'mef.serc_company_trading', label: 'SERC quarterly trading statistics' };

const GROWTH_BANDS: Band[] = [
  { label: 'Below -15% — contracting sharply', from: null, to: -15, score: 10, assessment: 'deteriorating' },
  { label: '-15% to -5% — contracting', from: -15, to: -5, score: 30, assessment: 'caution' },
  { label: '-5% to 5% — flat', from: -5, to: 5, score: 50, assessment: 'neutral' },
  { label: '5% to 20% — growing', from: 5, to: 20, score: 72, assessment: 'improving' },
  { label: 'Above 20% — growing quickly', from: 20, to: null, score: 88, assessment: 'improving' },
];

/**
 * Growth in the terms Cambodian data actually supports.
 *
 * Revenue and earnings growth would be the right measures, and they are used
 * when a filing has been loaded. Without one, the only genuine multi-period
 * series for a CSX issuer is SERC's quarterly market capitalisation — a measure
 * of how the market's valuation of the company has moved, which is a different
 * thing from business growth and is labelled as such.
 */
export function buildGrowth(input: AnalysisInput): Category {
  const metrics: Metric[] = [];
  const findings: Finding[] = [];
  const dataGaps: string[] = [];

  const withCap = input.periods.filter((period) => period.marketCap !== null);
  const first = withCap[0] ?? null;
  const last = withCap.at(-1) ?? null;
  const yearAgo = withCap.length >= 5 ? withCap[withCap.length - 5]! : null;

  const capChange =
    yearAgo && last ? pctChange(yearAgo.marketCap, last.marketCap) : first && last && first !== last ? pctChange(first.marketCap, last.marketCap) : null;
  const capResult = scoreWithBands(capChange, GROWTH_BANDS);

  metrics.push({
    key: 'market_cap_change',
    label: 'Change in reported market value',
    value: capChange,
    unit: 'percent',
    provenance: capChange === null ? 'unavailable' : 'calculated',
    method: yearAgo
      ? `Change in SERC's reported market capitalisation from ${yearAgo.label} to ${last!.label}.`
      : first && last
        ? `Change in SERC's reported market capitalisation from ${first.label} to ${last.label}.`
        : undefined,
    explanation:
      capChange === null
        ? 'SERC has not published enough quarters of market capitalisation for this issuer to measure a change.'
        : 'This tracks how the market has revalued the company between reported quarters. It is not a measure of revenue or profit growth.',
    assessment: capResult.assessment,
    score: capChange === null ? null : capResult.score,
    scale: toScale(GROWTH_BANDS),
    source: { ...SERC_SOURCE, asOf: last?.periodEnd ?? null },
  });

  const revenueSeries = input.financials.filter((row) => row.revenue !== null);
  const revenueGrowth =
    revenueSeries.length >= 2
      ? pctChange(revenueSeries.at(-2)!.revenue, revenueSeries.at(-1)!.revenue)
      : null;
  const revenueResult = scoreWithBands(revenueGrowth, GROWTH_BANDS);
  metrics.push({
    key: 'revenue_growth',
    label: 'Revenue growth',
    value: revenueGrowth,
    unit: 'percent',
    provenance: revenueGrowth === null ? 'unavailable' : 'calculated',
    method: 'Change in reported revenue between the two most recent loaded statements.',
    explanation:
      revenueGrowth === null
        ? 'Needs at least two filed income statements, which are not published in machine-readable form for CSX issuers.'
        : `Revenue moved ${round(revenueGrowth, 1)}% between the last two reported periods.`,
    assessment: revenueResult.assessment,
    score: revenueGrowth === null ? null : revenueResult.score,
    scale: toScale(GROWTH_BANDS),
  });

  const earningsSeries = input.financials.filter((row) => row.netIncome !== null);
  const earningsGrowth =
    earningsSeries.length >= 2
      ? pctChange(earningsSeries.at(-2)!.netIncome, earningsSeries.at(-1)!.netIncome)
      : null;
  const earningsResult = scoreWithBands(earningsGrowth, GROWTH_BANDS);
  metrics.push({
    key: 'earnings_growth',
    label: 'Earnings growth',
    value: earningsGrowth,
    unit: 'percent',
    provenance: earningsGrowth === null ? 'unavailable' : 'calculated',
    method: 'Change in reported net income between the two most recent loaded statements.',
    explanation:
      earningsGrowth === null
        ? 'Needs at least two filed income statements, which are not published in machine-readable form for CSX issuers.'
        : `Net income moved ${round(earningsGrowth, 1)}% between the last two reported periods.`,
    assessment: earningsResult.assessment,
    score: earningsGrowth === null ? null : earningsResult.score,
    scale: toScale(GROWTH_BANDS),
  });

  if (capChange !== null && Math.abs(capChange) >= 15) {
    findings.push({
      statement:
        capChange > 0
          ? `The market’s valuation of the company rose ${round(capChange, 1)}% between reported quarters.`
          : `The market’s valuation of the company fell ${round(Math.abs(capChange), 1)}% between reported quarters.`,
      assessment: capChange > 0 ? 'improving' : 'deteriorating',
      basis: ['market_cap_change'],
    });
  }

  if (input.financials.length < 2) {
    dataGaps.push(
      'Revenue and earnings growth need at least two filed statements. None are published for CSX issuers in machine-readable form, so business growth cannot be measured directly.',
    );
  }
  if (withCap.length < 2) {
    dataGaps.push('SERC has published fewer than two quarters of market value for this issuer.');
  }

  const score = averageScore(metrics);
  return {
    key: 'growth',
    label: 'Growth',
    question: 'Is the business getting bigger, and is the market recognising it?',
    score,
    assessment: assessmentForScore(score),
    metrics,
    findings,
    dataGaps,
  };
}
