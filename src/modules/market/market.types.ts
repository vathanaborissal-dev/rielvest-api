import type { Assessment } from '../../analysis/types.ts';

/** Wraps a figure with everything needed to say where it came from. */
export interface SourcedValue<T> {
  value: T;
  source: string;
  sourceLabel: string;
  sourceUrl?: string | null;
  asOf: string | null;
  provenance: 'reported' | 'calculated' | 'unavailable';
}

export interface QuoteView {
  symbol: string;
  name: string;
  sector: string | null;
  board: 'main' | 'growth';
  tradeDate: string;
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  value: number | null;
  pe: number | null;
  pb: number | null;
  /** The session CSX published these ratios for, which can lag the price. */
  ratiosAsOf: string | null;
  /** Return on equity implied by P/B ÷ P/E, when both are published. */
  roe: number | null;
  marketCap: number | null;
  marketCapPeriod: string | null;
}

export interface MarketBreadth {
  advancing: number;
  declining: number;
  unchanged: number;
  notTrading: number;
  total: number;
}

export interface IndexView {
  tradeDate: string;
  value: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  indexTime: string | null;
}

export interface CommentaryPoint {
  statement: string;
  assessment: Assessment;
  /** 'data' for an observation, 'interpretation' for a reading of it. */
  kind: 'data' | 'interpretation' | 'gap';
}

export interface MarketCommentary {
  headline: string;
  sentiment: Assessment;
  points: CommentaryPoint[];
  asOf: string | null;
  /** Named, so the reader knows this is generated, not editorial. */
  method: string;
}
