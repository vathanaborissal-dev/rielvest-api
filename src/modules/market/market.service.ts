import { toDateString, toNumber } from '../../core/decimal.ts';
import { median, pctChange } from '../../core/num.ts';
import { impliedRoePct } from '../../analysis/inputs.ts';
import * as repository from './market.repository.ts';
import type { IndexView, MarketBreadth, QuoteView } from './market.types.ts';
import { buildMarketCommentary } from './market.commentary.ts';
import { getMarketStatus, type MarketStatus } from './market.status.ts';

/**
 * Reads the market as a whole.
 *
 * Everything returned here is either a figure a publisher reported or a
 * calculation over those figures — never a placeholder. Where the exchange has
 * published nothing for an issuer, that issuer is reported as having no quote
 * rather than being dropped or shown as zero.
 */

function toQuoteView(
  quote: repository.QuoteWithCompany,
  marketCap?: { value: number; label: string },
  ratios?: { pe: number | null; pb: number | null; asOf: Date },
): QuoteView {
  const close = toNumber(quote.closeKhr)!;
  const change = toNumber(quote.changeKhr);
  // Fall back to the last session CSX published ratios for, carrying its date
  // so the interface can show when they were reported.
  const pe = toNumber(quote.pe) ?? ratios?.pe ?? null;
  const pb = toNumber(quote.pb) ?? ratios?.pb ?? null;
  const ratiosAsOf =
    toNumber(quote.pe) !== null || toNumber(quote.pb) !== null
      ? toDateString(quote.tradeDate)
      : (toDateString(ratios?.asOf ?? null) ?? null);
  // The previous close is the current close less the reported change, which
  // avoids needing a second query just to compute a percentage.
  const previousClose = change === null ? null : close - change;

  return {
    symbol: quote.company.symbol,
    name: quote.company.name,
    sector: quote.company.sector,
    board: quote.company.board,
    tradeDate: toDateString(quote.tradeDate)!,
    close,
    open: toNumber(quote.openKhr),
    high: toNumber(quote.highKhr),
    low: toNumber(quote.lowKhr),
    change,
    changePercent: previousClose === null ? null : pctChange(previousClose, close),
    volume: toNumber(quote.volume),
    value: toNumber(quote.valueKhr),
    pe,
    pb,
    ratiosAsOf,
    roe: impliedRoePct(pe, pb),
    marketCap: marketCap?.value ?? null,
    marketCapPeriod: marketCap?.label ?? null,
  };
}

export interface MarketSnapshot {
  status: MarketStatus;
  tradeDate: string | null;
  quotes: QuoteView[];
  index: IndexView | null;
  breadth: MarketBreadth;
  totalVolume: number;
  totalValue: number;
  totalMarketCap: number | null;
  totalMarketCapPeriod: string | null;
  usdPerKhr: number | null;
  listedCount: number;
  quotedCount: number;
}

export async function getSnapshot(): Promise<MarketSnapshot> {
  const tradeDate = await repository.latestTradeDate();
  if (!tradeDate) {
    return {
      status: getMarketStatus(),
      tradeDate: null,
      quotes: [],
      index: null,
      breadth: { advancing: 0, declining: 0, unchanged: 0, notTrading: 0, total: 0 },
      totalVolume: 0,
      totalValue: 0,
      totalMarketCap: null,
      totalMarketCapPeriod: null,
      usdPerKhr: null,
      listedCount: 0,
      quotedCount: 0,
    };
  }

  const [rawQuotes, indexRow, fxRow, latestPeriod, listedCount, capsByCompany, ratiosByCompany] =
    await Promise.all([
      repository.quotesOn(tradeDate),
      repository.latestIndexQuote(),
      repository.latestFxRate('USD', tradeDate),
      repository
        .marketPeriods({ board: 'all' })
        .then((rows) => [...rows].reverse().find((row) => row.marketCapKhr !== null) ?? null),
      repository.countListedCompanies(),
      repository.latestCompanyMarketCaps(),
      repository.latestReportedRatios(),
    ]);

  const quotes = rawQuotes.map((quote) =>
    toQuoteView(quote, capsByCompany.get(quote.companyId), ratiosByCompany.get(quote.companyId)),
  );

  const breadth = quotes.reduce<MarketBreadth>(
    (totals, quote) => {
      if (quote.volume === null || quote.volume === 0) totals.notTrading += 1;
      if (quote.change === null || quote.change === 0) totals.unchanged += 1;
      else if (quote.change > 0) totals.advancing += 1;
      else totals.declining += 1;
      totals.total += 1;
      return totals;
    },
    { advancing: 0, declining: 0, unchanged: 0, notTrading: 0, total: 0 },
  );

  return {
    status: getMarketStatus(),
    tradeDate: toDateString(tradeDate),
    quotes,
    index: indexRow
      ? {
          tradeDate: toDateString(indexRow.tradeDate)!,
          value: toNumber(indexRow.value)!,
          change: toNumber(indexRow.change),
          changePercent: toNumber(indexRow.changePercent),
          open: toNumber(indexRow.open),
          high: toNumber(indexRow.high),
          low: toNumber(indexRow.low),
          indexTime: indexRow.indexTime,
        }
      : null,
    breadth,
    totalVolume: quotes.reduce((sum, quote) => sum + (quote.volume ?? 0), 0),
    totalValue: quotes.reduce((sum, quote) => sum + (quote.value ?? 0), 0),
    totalMarketCap: latestPeriod ? toNumber(latestPeriod.marketCapKhr) : null,
    totalMarketCapPeriod: latestPeriod?.label ?? null,
    usdPerKhr: fxRow ? toNumber(fxRow.average) : null,
    listedCount,
    quotedCount: quotes.length,
  };
}

const byChangePercent = (a: QuoteView, b: QuoteView) => (b.changePercent ?? 0) - (a.changePercent ?? 0);

export function topGainers(quotes: QuoteView[], limit = 5): QuoteView[] {
  return quotes.filter((quote) => (quote.changePercent ?? 0) > 0).sort(byChangePercent).slice(0, limit);
}

export function topLosers(quotes: QuoteView[], limit = 5): QuoteView[] {
  return quotes
    .filter((quote) => (quote.changePercent ?? 0) < 0)
    .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))
    .slice(0, limit);
}

export function mostActive(quotes: QuoteView[], limit = 5): QuoteView[] {
  return [...quotes].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, limit);
}

export interface MarketOverview extends MarketSnapshot {
  gainers: QuoteView[];
  losers: QuoteView[];
  active: QuoteView[];
  medianPe: number | null;
  medianPb: number | null;
  commentary: Awaited<ReturnType<typeof buildMarketCommentary>>;
}

export async function getOverview(): Promise<MarketOverview> {
  const snapshot = await getSnapshot();
  const pes = snapshot.quotes.map((quote) => quote.pe).filter((pe): pe is number => pe !== null && pe > 0);
  const pbs = snapshot.quotes.map((quote) => quote.pb).filter((pb): pb is number => pb !== null && pb > 0);

  const previousDate = snapshot.tradeDate
    ? await repository.previousTradeDate(new Date(`${snapshot.tradeDate}T00:00:00.000Z`))
    : null;
  const previousQuotes = previousDate ? await repository.quotesOn(previousDate) : [];

  return {
    ...snapshot,
    gainers: topGainers(snapshot.quotes),
    losers: topLosers(snapshot.quotes),
    active: mostActive(snapshot.quotes),
    medianPe: median(pes),
    medianPb: median(pbs),
    commentary: buildMarketCommentary({
      snapshot,
      previousSessionValue: previousQuotes.length
        ? previousQuotes.reduce((sum, quote) => sum + (toNumber(quote.valueKhr) ?? 0), 0)
        : null,
      previousSessionDate: previousDate ? toDateString(previousDate) : null,
      medianPe: median(pes),
    }),
  };
}

export async function getIndexSeries(sinceDays?: number) {
  const since = sinceDays
    ? new Date(Date.now() - sinceDays * 86_400_000)
    : undefined;
  const rows = await repository.indexHistory('CSX', since);
  return rows.map((row) => ({
    tradeDate: toDateString(row.tradeDate)!,
    value: toNumber(row.value)!,
    change: toNumber(row.change),
    changePercent: toNumber(row.changePercent),
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
  }));
}

export async function getPeriodSeries(board: 'main' | 'growth' | 'all' = 'all') {
  const rows = await repository.marketPeriods({ board });
  return rows.map((row) => ({
    label: row.label,
    periodStart: toDateString(row.periodStart)!,
    periodEnd: toDateString(row.periodEnd)!,
    tradingDays: row.tradingDays,
    listedCompanies: row.listedCompanies,
    listedShares: toNumber(row.listedShares),
    marketCap: toNumber(row.marketCapKhr),
    tradingVolume: toNumber(row.tradingVolume),
    tradingValue: toNumber(row.tradingValueKhr),
    dailyAvgVolume: toNumber(row.dailyAvgVolume),
    dailyAvgValue: toNumber(row.dailyAvgValueKhr),
    buyOrderVolume: toNumber(row.buyOrderVolume),
    sellOrderVolume: toNumber(row.sellOrderVolume),
    indexClose: toNumber(row.indexClose),
    investorCount: row.investorCount,
    source: { code: row.sourceCode, datasetId: row.sourceDatasetId, url: row.sourceUrl },
  }));
}

