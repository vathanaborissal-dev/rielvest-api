import { round } from '../../core/num.ts';
import {
  impliedRoePct,
  latestReportedRatios,
  type AnalysisInput,
} from '../inputs.ts';
import { assessmentForScore, averageScore, scoreWithBands, toScale, type Band } from '../scoring.ts';
import type { Category, Finding, Metric } from '../types.ts';

const CSX_SOURCE = { code: 'mef.csx_summary', label: 'CSX daily trade summary' };

const ROE_BANDS: Band[] = [
  { label: 'Below 0% — losing money on shareholder capital', from: null, to: 0, score: 5, assessment: 'risk' },
  { label: '0% to 5% — weak', from: 0, to: 5, score: 25, assessment: 'caution' },
  { label: '5% to 10% — modest', from: 5, to: 10, score: 45, assessment: 'neutral' },
  { label: '10% to 15% — solid', from: 10, to: 15, score: 65, assessment: 'positive' },
  { label: '15% to 25% — strong', from: 15, to: 25, score: 85, assessment: 'positive' },
  { label: 'Above 25% — very strong', from: 25, to: null, score: 90, assessment: 'positive' },
];

const DEBT_TO_EQUITY_BANDS: Band[] = [
  { label: 'Below 0.5x — lightly geared', from: 0, to: 0.5, score: 85, assessment: 'positive' },
  { label: '0.5x to 1x — moderate', from: 0.5, to: 1, score: 65, assessment: 'neutral' },
  { label: '1x to 2x — meaningful leverage', from: 1, to: 2, score: 40, assessment: 'caution' },
  { label: 'Above 2x — heavily geared', from: 2, to: null, score: 15, assessment: 'risk' },
];

const NET_MARGIN_BANDS: Band[] = [
  { label: 'Below 0% — loss-making', from: null, to: 0, score: 5, assessment: 'risk' },
  { label: '0% to 5% — thin', from: 0, to: 5, score: 30, assessment: 'caution' },
  { label: '5% to 12% — reasonable', from: 5, to: 12, score: 55, assessment: 'neutral' },
  { label: '12% to 25% — healthy', from: 12, to: 25, score: 78, assessment: 'positive' },
  { label: 'Above 25% — very healthy', from: 25, to: null, score: 88, assessment: 'positive' },
];

/**
 * What can honestly be said about a CSX issuer's financial condition.
 *
 * No Cambodian source publishes machine-readable financial statements for
 * listed companies, so most of this category depends on filings RielVest does
 * not have. Return on equity is the exception: it falls straight out of the two
 * ratios CSX publishes daily, because P/B ÷ P/E cancels the price and leaves
 * earnings ÷ book value. Where a filing has been loaded, the remaining metrics
 * fill in; otherwise they are reported as gaps rather than estimated.
 */
export function buildFinancialHealth(input: AnalysisInput): Category {
  const metrics: Metric[] = [];
  const findings: Finding[] = [];
  const dataGaps: string[] = [];

  const ratios = latestReportedRatios(input.quotes);
  const asOf = ratios.asOf;
  const roe = impliedRoePct(ratios.pe, ratios.pb);
  const roeResult = scoreWithBands(roe, ROE_BANDS);

  metrics.push({
    key: 'roe',
    label: 'Return on equity',
    value: roe,
    unit: 'percent',
    provenance: roe === null ? 'unavailable' : 'calculated',
    method:
      'P/B ÷ P/E. The share price cancels out, leaving earnings per share ÷ book value per share — the definition of return on equity.',
    explanation:
      roe === null
        ? 'Needs both a positive P/E and a positive P/B from CSX; at least one is missing for this issuer.'
        : `The company earns about ${round(roe, 1)}% a year on the capital its shareholders have in it, based on CSX’s own reported ratios.`,
    assessment: roeResult.assessment,
    score: roe === null ? null : roeResult.score,
    scale: toScale(ROE_BANDS),
    source: { ...CSX_SOURCE, asOf },
  });

  // Anything below here needs a filed statement. RielVest only populates these
  // when one has actually been loaded for the issuer.
  const latestFinancial = input.financials.at(-1) ?? null;

  const netMargin =
    latestFinancial?.revenue && latestFinancial.revenue > 0 && latestFinancial.netIncome !== null
      ? (latestFinancial.netIncome / latestFinancial.revenue) * 100
      : null;
  const marginResult = scoreWithBands(netMargin, NET_MARGIN_BANDS);
  metrics.push({
    key: 'net_margin',
    label: 'Net profit margin',
    value: netMargin,
    unit: 'percent',
    provenance: netMargin === null ? 'unavailable' : 'calculated',
    method: 'Net income ÷ revenue from the most recent loaded financial statement.',
    explanation:
      netMargin === null
        ? 'No filed income statement has been loaded for this issuer, so margin cannot be measured.'
        : `${round(netMargin, 1)}% of revenue reaches the bottom line.`,
    assessment: marginResult.assessment,
    score: netMargin === null ? null : marginResult.score,
    scale: toScale(NET_MARGIN_BANDS),
  });

  const debtToEquity =
    latestFinancial?.totalEquity && latestFinancial.totalEquity > 0 && latestFinancial.totalDebt !== null
      ? latestFinancial.totalDebt / latestFinancial.totalEquity
      : null;
  const gearingResult = scoreWithBands(debtToEquity, DEBT_TO_EQUITY_BANDS);
  metrics.push({
    key: 'debt_to_equity',
    label: 'Debt to equity',
    value: debtToEquity,
    unit: 'x',
    provenance: debtToEquity === null ? 'unavailable' : 'calculated',
    method: 'Total debt ÷ total equity from the most recent loaded financial statement.',
    explanation:
      debtToEquity === null
        ? 'No filed balance sheet has been loaded for this issuer, so leverage cannot be measured.'
        : `The company carries ${round(debtToEquity, 2)} riel of debt for every riel of equity.`,
    assessment: gearingResult.assessment,
    score: debtToEquity === null ? null : gearingResult.score,
    scale: toScale(DEBT_TO_EQUITY_BANDS),
  });

  // --- Findings -------------------------------------------------------------

  if (roe !== null && roe >= 15) {
    findings.push({
      statement: `Return on equity of about ${round(roe, 1)}% is strong for the Cambodian market.`,
      assessment: 'positive',
      basis: ['roe'],
    });
  } else if (roe !== null && roe > 0 && roe < 5) {
    findings.push({
      statement: `Return on equity of about ${round(roe, 1)}% is low — shareholder capital is not earning much.`,
      assessment: 'caution',
      basis: ['roe'],
    });
  }

  if (roe === null) {
    dataGaps.push(
      'Return on equity needs a positive P/E and P/B from CSX; at least one is not published for this issuer.',
    );
  }
  if (input.financials.length === 0) {
    dataGaps.push(
      'No filed financial statements are available. Cambodia publishes no machine-readable income statements or balance sheets for listed companies, so revenue, margins, leverage and cash flow cannot be assessed.',
    );
    findings.push({
      statement:
        'Margins, leverage and cash flow cannot be assessed — no filed statements are published for CSX issuers in machine-readable form.',
      assessment: 'insufficient_data',
      basis: ['net_margin', 'debt_to_equity'],
    });
  }

  const score = averageScore(metrics);
  return {
    key: 'financial_health',
    label: 'Financial health',
    question: 'Is the business earning a good return, and is its balance sheet sound?',
    score,
    assessment: assessmentForScore(score),
    metrics,
    findings,
    dataGaps,
  };
}
