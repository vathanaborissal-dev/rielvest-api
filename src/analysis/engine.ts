import { round } from '../core/num.ts';
import { buildDividend } from './categories/dividend.ts';
import { buildFinancialHealth } from './categories/financialHealth.ts';
import { buildGrowth } from './categories/growth.ts';
import { buildMarketPerformance } from './categories/marketPerformance.ts';
import { buildRisk } from './categories/risk.ts';
import { buildValuation } from './categories/valuation.ts';
import { latestQuote, type AnalysisInput } from './inputs.ts';
import { buildNarrative } from './narrative.ts';
import { assessmentForScore, METHODOLOGY } from './scoring.ts';
import type { Assessment, Category, Finding, StockAnalysis } from './types.ts';

/**
 * The reusable analysis layer.
 *
 * It takes assembled numbers and returns a structured assessment. It knows
 * nothing about HTTP, Prisma or React, so the same output drives the company
 * page, the comparison table, the watchlist and the insights feed — and can be
 * unit-tested against fixtures.
 */

/** How the risks and opportunities lists are ordered, most serious first. */
const SEVERITY: Record<Assessment, number> = {
  risk: 0,
  deteriorating: 1,
  caution: 2,
  insufficient_data: 3,
  neutral: 4,
  improving: 5,
  positive: 6,
};

/**
 * Weights for the overall score.
 *
 * Valuation, financial health and risk carry the most weight because those are
 * the categories Cambodian data actually supports. Growth and dividend are
 * weighted lightly on purpose: for most CSX issuers they cannot be measured,
 * and a category that is usually unknown should not dominate a headline number.
 */
const CATEGORY_WEIGHTS: Record<Category['key'], number> = {
  valuation: 0.28,
  financial_health: 0.24,
  risk: 0.24,
  market_performance: 0.14,
  growth: 0.06,
  dividend: 0.04,
};

/** Categories the engine attempts, used to report how much it could cover. */
const EXPECTED_CATEGORIES = 6;

export function analyseStock(input: AnalysisInput): StockAnalysis {
  const categories: Category[] = [
    buildValuation(input),
    buildFinancialHealth(input),
    buildGrowth(input),
    buildDividend(input),
    buildMarketPerformance(input),
    buildRisk(input),
  ];

  const scored = categories.filter(
    (category): category is Category & { score: number } => category.score !== null,
  );

  // Re-normalise the weights across the categories that could actually be
  // scored, so a missing category dilutes confidence rather than the score.
  const totalWeight = scored.reduce((sum, category) => sum + CATEGORY_WEIGHTS[category.key], 0);
  const score =
    totalWeight > 0
      ? Math.round(
          scored.reduce(
            (sum, category) => sum + category.score * CATEGORY_WEIGHTS[category.key],
            0,
          ) / totalWeight,
        )
      : null;

  const allFindings = categories.flatMap((category) => category.findings);
  const risks = allFindings
    .filter((finding) => finding.assessment === 'risk' || finding.assessment === 'caution' || finding.assessment === 'deteriorating')
    .sort((a, b) => SEVERITY[a.assessment] - SEVERITY[b.assessment]);
  const opportunities = allFindings
    .filter((finding) => finding.assessment === 'positive' || finding.assessment === 'improving')
    .sort((a, b) => SEVERITY[b.assessment] - SEVERITY[a.assessment]);

  const dataGaps = [...new Set(categories.flatMap((category) => category.dataGaps))];
  const coverage = round((scored.length / EXPECTED_CATEGORIES) * 100, 0);

  return {
    symbol: input.symbol,
    name: input.name,
    asOf: latestQuote(input)?.tradeDate ?? null,
    score,
    assessment: assessmentForScore(score),
    coverage,
    categories,
    risks,
    opportunities,
    narrative: buildNarrative(input, categories, risks, opportunities),
    dataGaps,
    methodology: METHODOLOGY,
  };
}

export type { AnalysisInput } from './inputs.ts';
export type { Assessment, Category, Finding, Metric, StockAnalysis } from './types.ts';
