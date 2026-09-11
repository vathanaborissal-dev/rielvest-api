import { pctChange, round } from '../../core/num.ts';
import { latestQuote, type AnalysisInput } from '../inputs.ts';
import { assessmentForScore, averageScore, scoreWithBands, toScale, type Band } from '../scoring.ts';
import type { Category, Finding, Metric } from '../types.ts';

const YIELD_BANDS: Band[] = [
  { label: 'No dividend paid', from: 0, to: 0.01, score: 20, assessment: 'neutral' },
  { label: 'Under 2% — token', from: 0.01, to: 2, score: 40, assessment: 'neutral' },
  { label: '2% to 4% — moderate', from: 2, to: 4, score: 62, assessment: 'positive' },
  { label: '4% to 8% — attractive', from: 4, to: 8, score: 82, assessment: 'positive' },
  { label: 'Above 8% — unusually high, worth checking it is sustainable', from: 8, to: null, score: 60, assessment: 'caution' },
];

const CONSISTENCY_BANDS: Band[] = [
  { label: 'Paid in under half of recorded years', from: 0, to: 50, score: 25, assessment: 'caution' },
  { label: 'Paid in most recorded years', from: 50, to: 80, score: 55, assessment: 'neutral' },
  { label: 'Paid in nearly every recorded year', from: 80, to: null, score: 85, assessment: 'positive' },
];

/**
 * Dividend history for a CSX issuer.
 *
 * The CSX summary feed carries a dividend field, but it returns zero for every
 * issuer — indistinguishable from "not disclosed" — so the ingestion layer
 * discards it rather than recording a payout of nothing. Unless a dividend has
 * been loaded from a citable announcement, this category honestly reports that
 * it has nothing to work with.
 */
export function buildDividend(input: AnalysisInput): Category {
  const quote = latestQuote(input);
  const metrics: Metric[] = [];
  const findings: Finding[] = [];
  const dataGaps: string[] = [];

  const byYear = new Map<number, number>();
  for (const dividend of input.dividends) {
    const year =
      dividend.fiscalYear ??
      (dividend.paymentDate ? Number(dividend.paymentDate.slice(0, 4)) : null);
    if (year === null) continue;
    byYear.set(year, (byYear.get(year) ?? 0) + dividend.amountPerShare);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);

  const trailing = years.length > 0 ? byYear.get(years.at(-1)!)! : null;
  const yieldPct = trailing !== null && quote ? (trailing / quote.close) * 100 : null;
  const yieldResult = scoreWithBands(yieldPct, YIELD_BANDS);

  metrics.push({
    key: 'dividend_yield',
    label: 'Dividend yield',
    value: yieldPct,
    unit: 'percent',
    provenance: yieldPct === null ? 'unavailable' : 'calculated',
    method: 'Most recent full year of dividends per share ÷ the latest closing price.',
    explanation:
      yieldPct === null
        ? 'No dividend record is available for this issuer. CSX’s feed reports a dividend field of zero for every listed company, which RielVest treats as "not disclosed" rather than as a payout of nothing.'
        : `Based on ${round(trailing!, 0)} riel per share paid for ${years.at(-1)}.`,
    assessment: yieldResult.assessment,
    score: yieldPct === null ? null : yieldResult.score,
    scale: toScale(YIELD_BANDS),
  });

  const consistency =
    years.length >= 2
      ? (years.length / (years.at(-1)! - years[0]! + 1)) * 100
      : null;
  const consistencyResult = scoreWithBands(consistency, CONSISTENCY_BANDS);
  metrics.push({
    key: 'dividend_consistency',
    label: 'Payment consistency',
    value: consistency,
    unit: 'percent',
    provenance: consistency === null ? 'unavailable' : 'calculated',
    method: 'Years with a recorded dividend ÷ years spanned by the record.',
    explanation:
      consistency === null
        ? 'Needs at least two years of dividend records.'
        : `A dividend was recorded in ${years.length} of the ${years.at(-1)! - years[0]! + 1} years covered.`,
    assessment: consistencyResult.assessment,
    score: consistency === null ? null : consistencyResult.score,
    scale: toScale(CONSISTENCY_BANDS),
  });

  const growth =
    years.length >= 2
      ? pctChange(byYear.get(years.at(-2)!)!, byYear.get(years.at(-1)!)!)
      : null;
  metrics.push({
    key: 'dividend_growth',
    label: 'Dividend growth',
    value: growth,
    unit: 'percent',
    provenance: growth === null ? 'unavailable' : 'calculated',
    method: 'Change in dividends per share between the two most recent recorded years.',
    explanation:
      growth === null
        ? 'Needs at least two years of dividend records.'
        : `Dividends per share moved ${round(growth, 1)}% year on year.`,
    assessment: growth === null ? 'insufficient_data' : growth > 0 ? 'improving' : growth < 0 ? 'deteriorating' : 'neutral',
  });

  if (input.dividends.length === 0) {
    dataGaps.push(
      'No dividend history is available. No Cambodian source publishes CSX dividend announcements in machine-readable form, and the exchange’s own feed reports zero for every issuer.',
    );
    findings.push({
      statement:
        'Dividend history is unavailable for every CSX issuer, so income return cannot be assessed here.',
      assessment: 'insufficient_data',
      basis: ['dividend_yield'],
    });
  } else if (yieldPct !== null && yieldPct >= 4) {
    findings.push({
      statement: `A trailing yield of about ${round(yieldPct, 1)}% is meaningful income relative to the share price.`,
      assessment: 'positive',
      basis: ['dividend_yield'],
    });
  }

  const score = averageScore(metrics);
  return {
    key: 'dividend',
    label: 'Dividend',
    question: 'Does this company pay shareholders, and can it be relied on to keep doing so?',
    score,
    assessment: assessmentForScore(score),
    metrics,
    findings,
    dataGaps,
  };
}
