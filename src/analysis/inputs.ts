import { toDateString, toNumber } from '../core/decimal.ts';
import { mean, median, pctChange, stdDev } from '../core/num.ts';
import type { Board } from '../generated/prisma/client.ts';

/**
 * The shape the analysis engine works on.
 *
 * Everything here is plain numbers assembled by the service layer, so the
 * engine has no database dependency and can be unit-tested against fixtures.
 */

export interface QuotePoint {
  tradeDate: string;
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  volume: number | null;
  value: number | null;
  pe: number | null;
  pb: number | null;
}

export interface PeriodPoint {
  label: string;
  periodStart: string;
  periodEnd: string;
  marketCap: number | null;
  tradingVolume: number | null;
  tradingValue: number | null;
  dailyAvgVolume: number | null;
  dailyAvgValue: number | null;
}

export interface DividendPoint {
  fiscalYear: number | null;
  amountPerShare: number;
  paymentDate: string | null;
}

export interface FinancialPoint {
  fiscalYear: number;
  fiscalPeriod: string;
  revenue: number | null;
  netIncome: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
  totalAssets: number | null;
  operatingCashFlow: number | null;
}

export interface MarketContext {
  /** Median P/E across issuers that report one, for peer comparison. */
  medianPe: number | null;
  medianPb: number | null;
  /** Median daily traded value across the market, in riel. */
  medianDailyValue: number | null;
  /** Total traded value across every issuer in the latest session, in riel. */
  totalDailyValue: number | null;
  /** CSX index return over the same window as the stock's, in percent. */
  indexReturnPct: number | null;
  indexWindowSessions: number;
}

export interface AnalysisInput {
  symbol: string;
  name: string;
  board: Board;
  sector: string | null;
  listingDate: string | null;
  quotes: QuotePoint[];
  periods: PeriodPoint[];
  dividends: DividendPoint[];
  financials: FinancialPoint[];
  market: MarketContext;
}

// --- Derived series helpers -------------------------------------------------

export const latestQuote = (input: AnalysisInput): QuotePoint | null =>
  input.quotes.at(-1) ?? null;

export interface ReportedRatios {
  pe: number | null;
  pb: number | null;
  /** The session these ratios were published for, which may not be the latest. */
  asOf: string | null;
  /** True when the ratios come from an earlier session than the latest price. */
  isStale: boolean;
}

/**
 * The most recently published P/E and P/B, with the session they belong to.
 *
 * CSX publishes these in its end-of-session summary, which lands some hours
 * after the bell — so between the close and that publication the newest price
 * exists with no ratios attached. Carrying the last published pair forward,
 * labelled with its own date, is more useful than showing nothing and more
 * honest than implying they were published for today.
 *
 * The two are resolved independently because an issuer can have a P/B but no
 * P/E, which is how CSX reports a company with no positive earnings.
 */
export function latestReportedRatios(quotes: QuotePoint[]): ReportedRatios {
  const latestDate = quotes.at(-1)?.tradeDate ?? null;
  let pe: number | null = null;
  let pb: number | null = null;
  let asOf: string | null = null;

  for (let i = quotes.length - 1; i >= 0; i -= 1) {
    const quote = quotes[i]!;
    if (pe === null && quote.pe !== null) {
      pe = quote.pe;
      asOf ??= quote.tradeDate;
    }
    if (pb === null && quote.pb !== null) {
      pb = quote.pb;
      asOf ??= quote.tradeDate;
    }
    if (pe !== null && pb !== null) break;
  }

  return { pe, pb, asOf, isStale: asOf !== null && asOf !== latestDate };
}

/** Simple returns between consecutive recorded sessions, in percent. */
export function dailyReturns(quotes: QuotePoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < quotes.length; i += 1) {
    const change = pctChange(quotes[i - 1]!.close, quotes[i]!.close);
    if (change !== null) returns.push(change);
  }
  return returns;
}

/** Annualised volatility from daily returns; needs a usable sample. */
export function annualisedVolatility(quotes: QuotePoint[]): number | null {
  const returns = dailyReturns(quotes);
  if (returns.length < 10) return null;
  const daily = stdDev(returns);
  if (daily === null) return null;
  // CSX trades roughly 250 sessions a year (SERC reports ~59-65 per quarter).
  return daily * Math.sqrt(250);
}

export function priceReturnPct(quotes: QuotePoint[], sessions: number): number | null {
  if (quotes.length < 2) return null;
  const window = quotes.slice(-Math.min(sessions + 1, quotes.length));
  if (window.length < 2) return null;
  return pctChange(window[0]!.close, window.at(-1)!.close);
}

export function averageDailyValue(quotes: QuotePoint[], sessions = 20): number | null {
  const values = quotes
    .slice(-sessions)
    .map((quote) => quote.value)
    .filter((value): value is number => value !== null);
  return mean(values);
}

/** Most recent reported market capitalisation, with the period it covers. */
export function latestReportedMarketCap(
  input: AnalysisInput,
): { value: number; label: string; periodEnd: string } | null {
  for (let i = input.periods.length - 1; i >= 0; i -= 1) {
    const period = input.periods[i]!;
    if (period.marketCap !== null) {
      return { value: period.marketCap, label: period.label, periodEnd: period.periodEnd };
    }
  }
  return null;
}

/**
 * Return on equity from the two ratios CSX publishes daily.
 *
 * P/B ÷ P/E = (price ÷ book value per share) ÷ (price ÷ earnings per share)
 *           = earnings per share ÷ book value per share
 *           = return on equity.
 *
 * The price cancels, so this is the issuer's own reported ratios rearranged,
 * not an estimate. It is only meaningful when both ratios are positive.
 */
export function impliedRoePct(pe: number | null, pb: number | null): number | null {
  if (pe === null || pb === null || pe <= 0 || pb <= 0) return null;
  return (pb / pe) * 100;
}

/** Earnings per share implied by the reported P/E and the closing price. */
export function impliedEps(close: number, pe: number | null): number | null {
  if (pe === null || pe <= 0) return null;
  return close / pe;
}

/** Book value per share implied by the reported P/B and the closing price. */
export function impliedBookValue(close: number, pb: number | null): number | null {
  if (pb === null || pb <= 0) return null;
  return close / pb;
}

export function medianOf(values: (number | null)[]): number | null {
  return median(values.filter((value): value is number => value !== null));
}

export { toDateString, toNumber };
