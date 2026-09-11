/**
 * Vocabulary for RielVest's analysis output.
 *
 * Two rules shape these types:
 *
 *  1. **Provenance travels with every number.** A metric says whether it was
 *     reported by a publisher, calculated by RielVest, or is simply not
 *     available — and names the source and the date it refers to.
 *  2. **Absence is a first-class result.** "We don't know" is expressed as
 *     `insufficient_data` with a stated reason, never as a zero, an estimate or
 *     a quietly omitted row.
 */

/** How confident a reading is, in words rather than a buy/sell verdict. */
export type Assessment =
  | 'positive'
  | 'improving'
  | 'neutral'
  | 'caution'
  | 'risk'
  | 'deteriorating'
  | 'insufficient_data';

/** Where a figure came from. */
export type Provenance =
  /** Published as-is by CSX, SERC or another named publisher. */
  | 'reported'
  /** Derived by RielVest from reported figures, with the method stated. */
  | 'calculated'
  /** No trustworthy value exists; RielVest declines to guess. */
  | 'unavailable';

export interface MetricSource {
  code: string;
  label: string;
  url?: string | null;
  /** The period or date the figure describes. */
  asOf?: string | null;
}

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  /** 'khr' | 'ratio' | 'percent' | 'shares' | 'x' | 'days' | 'count' */
  unit: string;
  provenance: Provenance;
  /** Present when the value is calculated: how it was worked out. */
  method?: string;
  /** What this number means for someone reading it. */
  explanation?: string;
  assessment: Assessment;
  /** The 0-100 contribution to the category score, when the metric is scored. */
  score?: number | null;
  /** The thresholds behind `score`, so a reader can check the reasoning. */
  scale?: { label: string; from: number | null; to: number | null }[];
  source?: MetricSource;
}

export interface Finding {
  /** Short sentence in plain language. */
  statement: string;
  assessment: Assessment;
  /** The metric keys this finding was drawn from. */
  basis: string[];
}

export type CategoryKey =
  | 'valuation'
  | 'financial_health'
  | 'growth'
  | 'dividend'
  | 'market_performance'
  | 'risk';

export interface Category {
  key: CategoryKey;
  label: string;
  /** What this category is trying to answer. */
  question: string;
  /** Null when nothing in the category could be scored. */
  score: number | null;
  assessment: Assessment;
  metrics: Metric[];
  findings: Finding[];
  /** Named gaps: what could not be assessed, and why. */
  dataGaps: string[];
}

export interface StockAnalysis {
  symbol: string;
  name: string;
  asOf: string | null;
  /** Overall score, or null when too little is known to form one. */
  score: number | null;
  assessment: Assessment;
  /** How much of the intended analysis could actually be performed, 0-100. */
  coverage: number;
  categories: Category[];
  /** Everything worth flagging, ranked with the most serious first. */
  risks: Finding[];
  opportunities: Finding[];
  /** A short narrative built only from the findings above. */
  narrative: string[];
  dataGaps: string[];
  methodology: string;
}
