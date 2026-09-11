import { round } from '../../core/num.ts';
import {
  annualisedVolatility,
  averageDailyValue,
  impliedRoePct,
  latestQuote,
  latestReportedMarketCap,
  latestReportedRatios,
  type AnalysisInput,
} from '../inputs.ts';
import { assessmentForScore, averageScore, scoreWithBands, toScale, type Band } from '../scoring.ts';
import type { Category, Finding, Metric } from '../types.ts';

const CSX_SOURCE = { code: 'mef.csx_summary', label: 'CSX daily trade summary' };

const LIQUIDITY_BANDS: Band[] = [
  { label: 'Under 5 million riel a day — very thin', from: 0, to: 5_000_000, score: 12, assessment: 'risk' },
  { label: '5 to 25 million riel a day — thin', from: 5_000_000, to: 25_000_000, score: 32, assessment: 'caution' },
  { label: '25 to 100 million riel a day — workable', from: 25_000_000, to: 100_000_000, score: 60, assessment: 'neutral' },
  { label: 'Over 100 million riel a day — liquid by CSX standards', from: 100_000_000, to: null, score: 85, assessment: 'positive' },
];

const CONCENTRATION_BANDS: Band[] = [
  { label: 'Under 2% of the market’s daily turnover', from: 0, to: 2, score: 40, assessment: 'caution' },
  { label: '2% to 15% of daily turnover', from: 2, to: 15, score: 65, assessment: 'neutral' },
  { label: 'Over 15% of daily turnover', from: 15, to: null, score: 75, assessment: 'neutral' },
];

/**
 * Concrete, named risks rather than a single opaque rating.
 *
 * On a market with eleven listed equities, liquidity is the risk that matters
 * most and is also the one the available data measures best, so it leads. Each
 * finding states the number behind it.
 */
export function buildRisk(input: AnalysisInput): Category {
  const quote = latestQuote(input);
  const metrics: Metric[] = [];
  const findings: Finding[] = [];
  const dataGaps: string[] = [];

  const asOf = quote?.tradeDate ?? null;
  const ratios = latestReportedRatios(input.quotes);
  const dailyValue = averageDailyValue(input.quotes);
  const liquidityResult = scoreWithBands(dailyValue, LIQUIDITY_BANDS);

  metrics.push({
    key: 'liquidity',
    label: 'Trading liquidity',
    value: dailyValue,
    unit: 'khr',
    provenance: dailyValue === null ? 'unavailable' : 'calculated',
    method: 'Mean traded value across the most recent recorded sessions.',
    explanation:
      dailyValue === null
        ? 'No traded value has been recorded yet.'
        : `About ${round(dailyValue / 1_000_000, 1)} million riel changes hands on a typical day. Thin trading makes it harder to buy or sell without moving the price.`,
    assessment: liquidityResult.assessment,
    score: dailyValue === null ? null : liquidityResult.score,
    scale: toScale(LIQUIDITY_BANDS),
    source: { ...CSX_SOURCE, asOf },
  });

  // Measured against the exchange's actual session turnover, not an estimate.
  const latestValue = quote?.value ?? null;
  const shareOfMarket =
    latestValue !== null && input.market.totalDailyValue !== null && input.market.totalDailyValue > 0
      ? (latestValue / input.market.totalDailyValue) * 100
      : null;
  const concentrationResult = scoreWithBands(shareOfMarket, CONCENTRATION_BANDS);
  metrics.push({
    key: 'market_share_of_turnover',
    label: 'Share of market turnover',
    value: shareOfMarket,
    unit: 'percent',
    provenance: shareOfMarket === null ? 'unavailable' : 'calculated',
    method: 'This stock’s traded value in the latest session ÷ the exchange’s total turnover that session.',
    explanation:
      shareOfMarket === null
        ? 'Needs traded values for this stock and for the wider market.'
        : `${round(shareOfMarket, 1)}% of everything traded on CSX that session was this stock. A very small share means few natural buyers on the other side of a sale.`,
    assessment: concentrationResult.assessment,
    score: shareOfMarket === null ? null : concentrationResult.score,
    scale: toScale(CONCENTRATION_BANDS),
  });

  const volatility = annualisedVolatility(input.quotes);
  metrics.push({
    key: 'price_volatility',
    label: 'Price volatility',
    value: volatility,
    unit: 'percent',
    provenance: volatility === null ? 'unavailable' : 'calculated',
    method: 'Standard deviation of daily returns, annualised.',
    explanation:
      volatility === null
        ? `Needs at least ten recorded sessions; RielVest has ${input.quotes.length}.`
        : `Prices have varied by roughly ${round(volatility, 0)}% on an annualised basis.`,
    assessment: volatility === null ? 'insufficient_data' : volatility > 40 ? 'risk' : volatility > 25 ? 'caution' : 'neutral',
  });

  // --- Named risks ----------------------------------------------------------

  if (dailyValue !== null && dailyValue < 25_000_000) {
    findings.push({
      statement: `Liquidity is thin: about ${round(dailyValue / 1_000_000, 1)} million riel trades on a typical day, so a sizeable order could move the price against you.`,
      assessment: 'risk',
      basis: ['liquidity'],
    });
  }

  if (ratios.pe === null) {
    findings.push({
      statement:
        'CSX publishes no P/E for this issuer, which it does when there are no positive earnings — the company is not currently profitable on its last reported figures.',
      assessment: 'risk',
      basis: ['pe'],
    });
  }

  const roe = impliedRoePct(ratios.pe, ratios.pb);
  if (roe !== null && roe < 3) {
    findings.push({
      statement: `Return on equity of about ${round(roe, 1)}% is weak — the business earns little on the capital tied up in it.`,
      assessment: 'caution',
      basis: ['roe'],
    });
  }

  if (ratios.pe !== null && ratios.pe > 40) {
    findings.push({
      statement: `At ${round(ratios.pe, 0)}x earnings the price already assumes substantial growth, which leaves little room for disappointment.`,
      assessment: 'caution',
      basis: ['pe'],
    });
  }

  if (volatility !== null && volatility > 40) {
    findings.push({
      statement: `Annualised volatility of about ${round(volatility, 0)}% means the price moves sharply from day to day.`,
      assessment: 'risk',
      basis: ['price_volatility'],
    });
  }

  if (input.board === 'growth') {
    findings.push({
      statement:
        'Listed on the CSX Growth Board, which is designed for smaller companies and carries lighter disclosure requirements than the Main Board.',
      assessment: 'caution',
      basis: [],
    });
  }

  const marketCap = latestReportedMarketCap(input);
  if (marketCap && marketCap.value < 100_000_000_000) {
    findings.push({
      statement: `A reported market value of about ${round(marketCap.value / 1_000_000_000, 0)} billion riel (${marketCap.label}) makes this one of the smaller issuers on the exchange.`,
      assessment: 'caution',
      basis: ['market_cap'],
    });
  }

  if (input.financials.length === 0) {
    findings.push({
      statement:
        'Leverage and cash-flow risk cannot be assessed: no filed financial statements are published for CSX issuers in machine-readable form.',
      assessment: 'insufficient_data',
      basis: [],
    });
    dataGaps.push('Balance-sheet risk cannot be assessed without filed statements.');
  }

  if (input.quotes.length < 10) {
    dataGaps.push(
      `Volatility needs at least ten recorded sessions; RielVest has ${input.quotes.length}.`,
    );
  }

  const score = averageScore(metrics);
  return {
    key: 'risk',
    label: 'Risk',
    question: 'What could go wrong, and what cannot be checked?',
    score,
    assessment: assessmentForScore(score),
    metrics,
    findings,
    dataGaps,
  };
}
