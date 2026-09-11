import type { Assessment } from '../../analysis/types.ts';

/**
 * The pre-session brief.
 *
 * Structured as a ranked list rather than a dashboard because the question a
 * trader actually asks at 08:45 is "what, if anything, needs my attention
 * before the bell?" — and on a twelve-stock exchange the honest answer is
 * usually two or three things, not forty tiles.
 */

export type SignalKind =
  | 'big_move'
  | 'limit_move'
  | 'dividend_upcoming'
  | 'dividend_declared'
  | 'disclosure'
  | 'earnings_report'
  | 'breakout'
  | 'breakdown'
  | 'at_resistance'
  | 'at_support'
  | 'volume_surge'
  | 'overbought'
  | 'oversold'
  | 'range_high'
  | 'range_low'
  | 'illiquid'
  | 'gap';

/** Where a figure came from, so a reader can weigh it. */
export interface Evidence {
  label: string;
  value: string;
  /** 'reported' for a published figure, 'calculated' for RielVest arithmetic. */
  provenance: 'reported' | 'calculated';
}

export interface TradeConstraints {
  /** Previous close, which sets today's band. */
  basePrice: number;
  limitUp: number;
  limitDown: number;
  tickSize: number;
  /** Typical traded value per session, in riel. */
  typicalDailyValue: number | null;
  /** Shares that stay inside a tenth of a normal session's turnover. */
  comfortableShares: number | null;
  liquidityNote: string;
  settlementDate: string;
  /**
   * The prices worth having written down for this stock today, every one of
   * them already snapped to a tick the exchange will accept.
   */
  keyPrices: KeyPrice[];
}

export interface KeyPrice {
  label: string;
  price: number;
  /** Distance from the last close, in percent. */
  distancePercent: number;
  /** What this price means, in one line. */
  meaning: string;
}

export interface BriefingSignal {
  /** 1 is most urgent. Ties are broken by the underlying score. */
  priority: number;
  score: number;
  kind: SignalKind;
  symbol: string;
  name: string;
  assessment: Assessment;
  /** One scannable line. */
  headline: string;
  /** Why it matters, and what would confirm or contradict it. */
  detail: string;
  evidence: Evidence[];
  /** Prices worth having in front of you for this stock today. */
  constraints: TradeConstraints | null;
  /** Link out to the source when the signal came from a disclosure. */
  sourceUrl?: string | null;
}

export interface MarketPulse {
  indexValue: number | null;
  indexChangePercent: number | null;
  advancing: number;
  declining: number;
  unchanged: number;
  turnover: number;
  /** Turnover against its own 20-session average. */
  turnoverRatio: number | null;
  /** Share of turnover taken by the single busiest stock. */
  concentrationPercent: number | null;
  concentrationSymbol: string | null;
  medianPe: number | null;
  breadthNote: string;
}

export interface MarketBriefing {
  /** The session the brief describes. */
  asOf: string | null;
  generatedAt: string;
  status: {
    phase: string;
    label: string;
    acceptsOrders: boolean;
    nextOpen: string | null;
  };
  /** Two or three sentences: the whole brief, if you read nothing else. */
  headline: string[];
  pulse: MarketPulse;
  /**
   * The handful that actually need a decision before the bell. On a market
   * this size that is usually three to five things; a longer list is noise
   * dressed as diligence.
   */
  focus: BriefingSignal[];
  /** Everything worth attention, most urgent first. */
  signals: BriefingSignal[];
  /** Stocks with nothing notable, named so their absence is deliberate. */
  quiet: string[];
  method: string;
  caution: string;
}
