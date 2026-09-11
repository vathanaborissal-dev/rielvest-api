import type { StockAnalysis, Assessment } from './types.ts';
import type { TradePlan } from './tradePlan.ts';
import { daysBetween } from '../core/dates.ts';

export interface ReviewNews { title: string; date: string; url: string | null }
export interface DecisionReview {
  symbol: string;
  asOf: string | null;
  stance: 'research' | 'wait' | 'insufficient_data';
  headline: string;
  coverage: number;
  factors: { label: string; assessment: Assessment; score: number | null }[];
  strengths: string[];
  cautions: string[];
  nextCheck: string;
  gaps: string[];
  news: ReviewNews[];
  summary: { lines: string[]; source: 'model' | 'engine'; model: string | null };
}

/** A checklist for further research, never a probability of profit or a trade instruction. */
export function buildDecisionReview(
  analysis: StockAnalysis,
  plan: TradePlan,
  news: ReviewNews[],
  today: string,
): DecisionReview {
  const stale = !analysis.asOf || daysBetween(analysis.asOf, today) > 4;
  const mismatched = analysis.asOf !== plan.asOf;
  const missing = stale || mismatched || analysis.coverage < 50 || !plan.rules;
  const unpricedNews = news.some((item) => analysis.asOf !== null && item.date >= analysis.asOf);
  const severe = analysis.risks.some((risk) => risk.assessment === 'risk' || risk.assessment === 'deteriorating');
  const thin = plan.rules?.workableValue == null || plan.rules.workableValue < 2_500_000;
  const stance = missing ? 'insufficient_data' : severe || thin || unpricedNews ? 'wait' : 'research';
  const cautions = [
    ...(stale ? ['The recorded price is missing or more than four calendar days old. Refresh the quote before considering an entry.'] : []),
    ...(mismatched ? ['Price levels and company analysis refer to different sessions. Refresh before comparing them.'] : []),
    ...(unpricedNews ? ['A filing is dated on or after the recorded session. Its timing and price impact need checking.'] : []),
    ...(thin ? ['Recorded turnover does not support the screen’s reference position size. Check available buyers and sellers.'] : []),
    ...analysis.risks.map((finding) => finding.statement),
    ...plan.caveats,
  ];
  return {
    symbol: analysis.symbol,
    asOf: analysis.asOf,
    stance,
    headline: missing ? 'More evidence needed' : stance === 'wait' ? 'Resolve the cautions first' : 'Worth a closer look',
    coverage: analysis.coverage,
    factors: analysis.categories.map(({ label, assessment, score }) => ({ label, assessment, score })),
    strengths: analysis.opportunities.slice(0, 2).map((finding) => finding.statement),
    cautions: [...new Set(cautions)].slice(0, 3),
    nextCheck: missing
      ? 'Check the latest quote and missing company figures before relying on this setup.'
      : unpricedNews
        ? 'Read the latest filing, then check whether the market has traded since its release.'
        : thin
          ? 'Check the live bid, ask and available quantity with your broker before choosing a position size.'
          : severe
            ? 'Read the underlying financial results to see whether the main risk has changed.'
            : 'Compare the support and resistance references with the live bid and ask; choose your maximum loss before placing an order.',
    gaps: analysis.dataGaps,
    news: news.slice(0, 2),
    summary: { lines: analysis.narrative, source: 'engine', model: null },
  };
}
