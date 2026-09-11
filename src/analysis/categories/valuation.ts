import { round } from '../../core/num.ts';
import {
  impliedBookValue,
  impliedEps,
  latestQuote,
  latestReportedMarketCap,
  latestReportedRatios,
  type AnalysisInput,
} from '../inputs.ts';
import { assessmentForScore, averageScore, scoreWithBands, toScale, type Band } from '../scoring.ts';
import type { Category, Finding, Metric } from '../types.ts';

const CSX_SOURCE = { code: 'mef.csx_summary', label: 'CSX daily trade summary' };
const SERC_SOURCE = { code: 'mef.serc_company_trading', label: 'SERC quarterly trading statistics' };

/**
 * Price/earnings bands.
 *
 * Frontier markets trade at lower multiples than developed ones, so the bands
 * sit below what a global screen would use. A negative or absent P/E means the
 * issuer is not profitable on its last reported earnings, which is a caution
 * rather than a cheap valuation.
 */
const PE_BANDS: Band[] = [
  { label: 'Under 8x — low relative to earnings', from: 0, to: 8, score: 85, assessment: 'positive' },
  { label: '8x to 15x — moderate', from: 8, to: 15, score: 70, assessment: 'positive' },
  { label: '15x to 25x — full', from: 15, to: 25, score: 50, assessment: 'neutral' },
  { label: '25x to 40x — demanding', from: 25, to: 40, score: 30, assessment: 'caution' },
  { label: 'Above 40x — priced for substantial growth', from: 40, to: null, score: 12, assessment: 'risk' },
];

const PB_BANDS: Band[] = [
  { label: 'Under 1x — below stated book value', from: 0, to: 1, score: 85, assessment: 'positive' },
  { label: '1x to 2x — moderate', from: 1, to: 2, score: 68, assessment: 'positive' },
  { label: '2x to 4x — full', from: 2, to: 4, score: 45, assessment: 'neutral' },
  { label: '4x to 8x — demanding', from: 4, to: 8, score: 25, assessment: 'caution' },
  { label: 'Above 8x — a large premium to book value', from: 8, to: null, score: 10, assessment: 'risk' },
];

export function buildValuation(input: AnalysisInput): Category {
  const quote = latestQuote(input);
  const metrics: Metric[] = [];
  const findings: Finding[] = [];
  const dataGaps: string[] = [];

  const ratios = latestReportedRatios(input.quotes);
  // Ratios carry the session they were published for, which lags the latest
  // price whenever CSX has not yet published the current session's summary.
  const asOf = ratios.asOf;
  const pe = ratios.pe;
  const pb = ratios.pb;
  const staleNote = ratios.isStale
    ? ` Published by CSX for the ${asOf} session; the exchange has not yet released ratios for the latest session.`
    : '';

  const peResult = scoreWithBands(pe !== null && pe > 0 ? pe : null, PE_BANDS);
  metrics.push({
    key: 'pe',
    label: 'Price / earnings',
    value: pe,
    unit: 'x',
    provenance: pe === null ? 'unavailable' : 'reported',
    explanation:
      pe === null
        ? 'CSX publishes no P/E for this issuer, which it does when the company has no positive earnings to divide by.'
        : `The market is paying ${round(pe, 2)} riel for each riel of the company's last reported annual earnings.${staleNote}`,
    assessment: pe === null ? 'caution' : peResult.assessment,
    score: pe === null ? null : peResult.score,
    scale: toScale(PE_BANDS),
    source: { ...CSX_SOURCE, asOf },
  });

  const pbResult = scoreWithBands(pb !== null && pb > 0 ? pb : null, PB_BANDS);
  metrics.push({
    key: 'pb',
    label: 'Price / book',
    value: pb,
    unit: 'x',
    provenance: pb === null ? 'unavailable' : 'reported',
    explanation:
      pb === null
        ? 'CSX publishes no P/B for this issuer.'
        : `The shares trade at ${round(pb, 2)} times the company's stated net asset value per share.${staleNote}`,
    assessment: pb === null ? 'insufficient_data' : pbResult.assessment,
    score: pb === null ? null : pbResult.score,
    scale: toScale(PB_BANDS),
    source: { ...CSX_SOURCE, asOf },
  });

  // Earnings yield is the reciprocal of P/E — the same fact stated in a way
  // that can be compared against a deposit or bond rate.
  const earningsYield = pe !== null && pe > 0 ? (1 / pe) * 100 : null;
  metrics.push({
    key: 'earnings_yield',
    label: 'Earnings yield',
    value: earningsYield,
    unit: 'percent',
    provenance: earningsYield === null ? 'unavailable' : 'calculated',
    method: '1 ÷ P/E, expressed as a percentage.',
    explanation:
      earningsYield === null
        ? 'Cannot be worked out without a positive P/E.'
        : `Each riel invested is backed by ${round(earningsYield, 2)}% of annual reported earnings, which you can compare against a deposit rate.`,
    assessment: 'neutral',
    source: { ...CSX_SOURCE, asOf },
  });

  // Derived from the close of the session the ratio was published for, not
  // from a later price the ratio never described.
  const ratioSessionClose =
    input.quotes.find((candidate) => candidate.tradeDate === asOf)?.close ?? quote?.close ?? null;
  const eps = ratioSessionClose !== null ? impliedEps(ratioSessionClose, pe) : null;
  metrics.push({
    key: 'eps',
    label: 'Earnings per share',
    value: eps,
    unit: 'khr',
    provenance: eps === null ? 'unavailable' : 'calculated',
    method: `Closing price on ${asOf ?? 'the latest session'} ÷ the P/E ratio CSX reported for it.`,
    explanation:
      eps === null
        ? 'No filed income statement is published in machine-readable form for CSX issuers, and without a positive P/E this cannot be derived either.'
        : 'Derived from CSX’s own reported ratio, not read from a filed income statement.',
    assessment: 'neutral',
    source: { ...CSX_SOURCE, asOf },
  });

  const bookValue = ratioSessionClose !== null ? impliedBookValue(ratioSessionClose, pb) : null;
  metrics.push({
    key: 'book_value_per_share',
    label: 'Book value per share',
    value: bookValue,
    unit: 'khr',
    provenance: bookValue === null ? 'unavailable' : 'calculated',
    method: `Closing price on ${asOf ?? 'the latest session'} ÷ the P/B ratio CSX reported for it.`,
    explanation:
      bookValue === null
        ? 'Cannot be derived without a reported P/B.'
        : 'Derived from CSX’s own reported ratio, not read from a filed balance sheet.',
    assessment: 'neutral',
    source: { ...CSX_SOURCE, asOf },
  });

  const marketCap = latestReportedMarketCap(input);
  metrics.push({
    key: 'market_cap',
    label: 'Market capitalisation',
    value: marketCap?.value ?? null,
    unit: 'khr',
    provenance: marketCap ? 'reported' : 'unavailable',
    explanation: marketCap
      ? `As reported by SERC for ${marketCap.label}. No Cambodian source publishes per-company share counts, so RielVest shows the regulator's figure rather than multiplying price by an assumed share count.`
      : 'SERC has not published a market capitalisation for this issuer.',
    assessment: 'neutral',
    source: { ...SERC_SOURCE, asOf: marketCap?.periodEnd ?? null },
  });

  // --- Findings -------------------------------------------------------------

  if (pe !== null && pe > 0 && input.market.medianPe !== null) {
    const versus = pe / input.market.medianPe;
    if (versus <= 0.7) {
      findings.push({
        statement: `Trades at ${round(pe, 1)}x earnings against a market median of ${round(input.market.medianPe, 1)}x — a discount to the rest of the exchange.`,
        assessment: 'positive',
        basis: ['pe'],
      });
    } else if (versus >= 1.5) {
      findings.push({
        statement: `Trades at ${round(pe, 1)}x earnings against a market median of ${round(input.market.medianPe, 1)}x — a clear premium to the rest of the exchange.`,
        assessment: 'caution',
        basis: ['pe'],
      });
    }
  }

  if (pb !== null && pb > 0 && pb < 1) {
    findings.push({
      statement: `The shares trade below stated book value at ${round(pb, 2)}x, meaning the market values the company at less than its own accounts do.`,
      assessment: 'positive',
      basis: ['pb'],
    });
  }

  if (pe === null) {
    findings.push({
      statement:
        'CSX publishes no P/E for this issuer, which it does when there are no positive earnings to divide by.',
      assessment: 'caution',
      basis: ['pe'],
    });
    dataGaps.push('No P/E is published, so earnings-based valuation cannot be assessed.');
  }
  if (pb === null) dataGaps.push('No P/B is published, so asset-based valuation cannot be assessed.');
  if (!marketCap) dataGaps.push('No reported market capitalisation is available for this issuer.');

  const score = averageScore(metrics);
  return {
    key: 'valuation',
    label: 'Valuation',
    question: 'What is the market paying for this company’s earnings and assets?',
    score,
    assessment: assessmentForScore(score),
    metrics,
    findings,
    dataGaps,
  };
}
