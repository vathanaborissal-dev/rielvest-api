import { round } from '../../core/num.ts';
import {
  annualisedVolatility,
  averageDailyValue,
  latestQuote,
  priceReturnPct,
  type AnalysisInput,
} from '../inputs.ts';
import { assessmentForScore, averageScore, scoreWithBands, toScale, type Band } from '../scoring.ts';
import type { Category, Finding, Metric } from '../types.ts';

const CSX_SOURCE = { code: 'mef.csx_summary', label: 'CSX daily trade summary' };

const RETURN_BANDS: Band[] = [
  { label: 'Below -20% — sharply lower', from: null, to: -20, score: 12, assessment: 'deteriorating' },
  { label: '-20% to -5% — lower', from: -20, to: -5, score: 32, assessment: 'caution' },
  { label: '-5% to 5% — broadly flat', from: -5, to: 5, score: 50, assessment: 'neutral' },
  { label: '5% to 20% — higher', from: 5, to: 20, score: 72, assessment: 'improving' },
  { label: 'Above 20% — sharply higher', from: 20, to: null, score: 85, assessment: 'improving' },
];

const VOLATILITY_BANDS: Band[] = [
  { label: 'Under 15% — very steady', from: 0, to: 15, score: 85, assessment: 'positive' },
  { label: '15% to 30% — typical', from: 15, to: 30, score: 65, assessment: 'neutral' },
  { label: '30% to 50% — choppy', from: 30, to: 50, score: 35, assessment: 'caution' },
  { label: 'Above 50% — highly volatile', from: 50, to: null, score: 15, assessment: 'risk' },
];

const RELATIVE_BANDS: Band[] = [
  { label: 'More than 10 points behind the index', from: null, to: -10, score: 20, assessment: 'caution' },
  { label: 'Behind the index', from: -10, to: -2, score: 40, assessment: 'neutral' },
  { label: 'In line with the index', from: -2, to: 2, score: 55, assessment: 'neutral' },
  { label: 'Ahead of the index', from: 2, to: 10, score: 72, assessment: 'improving' },
  { label: 'More than 10 points ahead of the index', from: 10, to: null, score: 85, assessment: 'improving' },
];

/**
 * How the shares have actually traded.
 *
 * Everything here comes from the daily sessions RielVest has recorded. The
 * upstream feed publishes only the current session with no history parameter,
 * so this window starts when RielVest began collecting and lengthens by one
 * session each trading day. Where the window is too short for a measure to mean
 * anything, the measure says so rather than being computed on thin air.
 */
export function buildMarketPerformance(input: AnalysisInput): Category {
  const quote = latestQuote(input);
  const metrics: Metric[] = [];
  const findings: Finding[] = [];
  const dataGaps: string[] = [];

  const sessions = input.quotes.length;
  const asOf = quote?.tradeDate ?? null;

  const totalReturn = priceReturnPct(input.quotes, sessions);
  const returnResult = scoreWithBands(totalReturn, RETURN_BANDS);
  metrics.push({
    key: 'price_return',
    label: `Price change over ${sessions} recorded session${sessions === 1 ? '' : 's'}`,
    value: totalReturn,
    unit: 'percent',
    provenance: totalReturn === null ? 'unavailable' : 'calculated',
    method: 'Change in closing price from the first to the most recent session RielVest has recorded.',
    explanation:
      totalReturn === null
        ? 'At least two recorded sessions are needed. The exchange publishes only the current session, so RielVest builds this history one trading day at a time.'
        : `Measured across the ${sessions} sessions RielVest has recorded so far.`,
    assessment: returnResult.assessment,
    score: totalReturn === null ? null : returnResult.score,
    scale: toScale(RETURN_BANDS),
    source: { ...CSX_SOURCE, asOf },
  });

  const relative =
    totalReturn !== null && input.market.indexReturnPct !== null
      ? totalReturn - input.market.indexReturnPct
      : null;
  const relativeResult = scoreWithBands(relative, RELATIVE_BANDS);
  metrics.push({
    key: 'relative_to_index',
    label: 'Versus the CSX index',
    value: relative,
    unit: 'percent',
    provenance: relative === null ? 'unavailable' : 'calculated',
    method: 'The share’s price change minus the CSX index change over the same recorded window.',
    explanation:
      relative === null
        ? 'Needs both a price history and an index history over the same window.'
        : relative >= 0
          ? `The shares outpaced the wider market by ${round(relative, 1)} percentage points.`
          : `The shares lagged the wider market by ${round(Math.abs(relative), 1)} percentage points.`,
    assessment: relativeResult.assessment,
    score: relative === null ? null : relativeResult.score,
    scale: toScale(RELATIVE_BANDS),
    source: { code: 'mef.csx_index', label: 'CSX composite index', asOf },
  });

  const volatility = annualisedVolatility(input.quotes);
  const volatilityResult = scoreWithBands(volatility, VOLATILITY_BANDS);
  metrics.push({
    key: 'volatility',
    label: 'Annualised volatility',
    value: volatility,
    unit: 'percent',
    provenance: volatility === null ? 'unavailable' : 'calculated',
    method:
      'Standard deviation of daily returns, scaled by the square root of 250 trading days a year.',
    explanation:
      volatility === null
        ? `Needs at least ten recorded sessions; RielVest has ${sessions}.`
        : `Day-to-day price movement implies roughly ${round(volatility, 0)}% annual variation.`,
    assessment: volatilityResult.assessment,
    score: volatility === null ? null : volatilityResult.score,
    scale: toScale(VOLATILITY_BANDS),
    source: { ...CSX_SOURCE, asOf },
  });

  const dailyValue = averageDailyValue(input.quotes);
  metrics.push({
    key: 'avg_daily_value',
    label: 'Average daily traded value',
    value: dailyValue,
    unit: 'khr',
    provenance: dailyValue === null ? 'unavailable' : 'calculated',
    method: 'Mean traded value across the most recent recorded sessions (up to twenty).',
    explanation:
      dailyValue === null
        ? 'No traded value has been recorded yet.'
        : 'How much money changes hands in this stock on a typical day.',
    assessment: 'neutral',
    source: { ...CSX_SOURCE, asOf },
  });

  if (relative !== null && Math.abs(relative) >= 5) {
    findings.push({
      statement:
        relative > 0
          ? `Has outperformed the CSX index by ${round(relative, 1)} percentage points over the recorded window.`
          : `Has underperformed the CSX index by ${round(Math.abs(relative), 1)} percentage points over the recorded window.`,
      assessment: relative > 0 ? 'improving' : 'caution',
      basis: ['relative_to_index'],
    });
  }

  if (sessions < 10) {
    dataGaps.push(
      `Only ${sessions} trading session${sessions === 1 ? ' has' : 's have'} been recorded so far. The exchange's feed exposes only the current session, so volatility and longer-run performance become available as RielVest collects more days.`,
    );
  }

  const score = averageScore(metrics);
  return {
    key: 'market_performance',
    label: 'Market performance',
    question: 'How have the shares traded, and how does that compare with the wider market?',
    score,
    assessment: assessmentForScore(score),
    metrics,
    findings,
    dataGaps,
  };
}
