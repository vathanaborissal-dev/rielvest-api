import { analyseStock } from '../../analysis/engine.ts';
import { buildPriceLevels, type PriceLevels } from '../../analysis/levels.ts';
import { buildTradePlan, type TradePlan } from '../../analysis/tradePlan.ts';
import type { Bar } from '../../analysis/indicators.ts';
import type { AnalysisInput, MarketContext, PeriodPoint, QuotePoint } from '../../analysis/inputs.ts';
import { impliedRoePct, priceReturnPct } from '../../analysis/inputs.ts';
import type { StockAnalysis } from '../../analysis/types.ts';
import { toDateColumn, toDateString, toNumber } from '../../core/decimal.ts';
import { prisma } from '../../core/prisma.ts';
import { notFound } from '../../core/errors.ts';
import { median, pctChange } from '../../core/num.ts';
import {
  fetchCsxChartBars,
  type CsxChartBar,
  type ChartInterval,
  type ChartRange,
} from '../../ingest/csxChartClient.ts';
import * as marketRepository from '../market/market.repository.ts';
import * as repository from './companies.repository.ts';
import type { CompanyRecord } from './companies.repository.ts';

/** The company profile as the interface consumes it, provenance included. */
export interface CompanyView {
  id: string;
  symbol: string;
  isin: string | null;
  name: string;
  legalName: string | null;
  sector: string | null;
  industry: string | null;
  board: 'main' | 'growth';
  listingDate: string | null;
  yearsListed: number | null;
  website: string | null;
  description: string | null;
  status: string;
  reference: {
    source: string | null;
    sourceName: string | null;
    publisher: string | null;
    url: string | null;
    note: string | null;
  };
}

function toCompanyView(company: CompanyRecord): CompanyView {
  const listingDate = toDateString(company.listingDate);
  return {
    id: company.id,
    symbol: company.symbol,
    isin: company.isin,
    name: company.name,
    legalName: company.legalName,
    sector: company.sector,
    industry: company.industry,
    board: company.board,
    listingDate,
    yearsListed: listingDate
      ? Math.floor((Date.now() - Date.parse(listingDate)) / (365.25 * 86_400_000))
      : null,
    website: company.website,
    description: company.description,
    status: company.status,
    reference: {
      source: company.sourceCode,
      sourceName: company.source?.name ?? null,
      publisher: company.source?.publisher ?? null,
      url: company.sourceUrl,
      note: company.sourceNote,
    },
  };
}

const toQuotePoint = (quote: {
  tradeDate: Date;
  closeKhr: unknown;
  openKhr: unknown;
  highKhr: unknown;
  lowKhr: unknown;
  changeKhr: unknown;
  volume: unknown;
  valueKhr: unknown;
  pe: unknown;
  pb: unknown;
}): QuotePoint => ({
  tradeDate: toDateString(quote.tradeDate)!,
  close: toNumber(quote.closeKhr as never)!,
  open: toNumber(quote.openKhr as never),
  high: toNumber(quote.highKhr as never),
  low: toNumber(quote.lowKhr as never),
  change: toNumber(quote.changeKhr as never),
  volume: toNumber(quote.volume as never),
  value: toNumber(quote.valueKhr as never),
  pe: toNumber(quote.pe as never),
  pb: toNumber(quote.pb as never),
});

export async function list(filter: { search?: string; sector?: string; board?: 'main' | 'growth' }) {
  const [companies, tradeDate, caps, ratios] = await Promise.all([
    repository.listCompanies(filter),
    marketRepository.latestTradeDate(),
    marketRepository.latestCompanyMarketCaps(),
    // CSX publishes ratios hours after the close, so the newest session often
    // has a price and no P/E. Carry the last published pair with its own date
    // rather than showing an empty column that reads as "never reported".
    marketRepository.latestReportedRatios(),
  ]);

  const quotes = tradeDate ? await marketRepository.quotesOn(tradeDate) : [];
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.company.symbol, quote]));

  return companies.map((company) => {
    const quote = quoteBySymbol.get(company.symbol);
    const close = quote ? toNumber(quote.closeKhr) : null;
    const change = quote ? toNumber(quote.changeKhr) : null;
    const reported = ratios.get(company.id);
    const pe = (quote ? toNumber(quote.pe) : null) ?? reported?.pe ?? null;
    const pb = (quote ? toNumber(quote.pb) : null) ?? reported?.pb ?? null;
    const cap = caps.get(company.id);

    return {
      ...toCompanyView(company),
      // A listed company with no quote is a real state, not an error: the
      // exchange's feed does not yet carry every issuer.
      hasQuote: Boolean(quote),
      tradeDate: quote ? toDateString(quote.tradeDate) : null,
      close,
      change,
      changePercent: change !== null && close !== null ? pctChange(close - change, close) : null,
      volume: quote ? toNumber(quote.volume) : null,
      value: quote ? toNumber(quote.valueKhr) : null,
      pe,
      pb,
      ratiosAsOf: toDateString(reported?.asOf ?? null),
      roe: impliedRoePct(pe, pb),
      marketCap: cap?.value ?? null,
      marketCapPeriod: cap?.label ?? null,
    };
  });
}

export const listSectors = repository.listSectors;

export async function getBySymbol(symbol: string): Promise<CompanyView> {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);
  return toCompanyView(company);
}

export async function getQuotes(symbol: string) {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);
  const quotes = await marketRepository.quoteHistory(company.id);
  return quotes.map(toQuotePoint);
}

const chartCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof buildChart>> }>();

const RANGE_SECONDS: Record<Exclude<ChartRange, 'max'>, number> = {
  '1d': 86_400,
  '5d': 5 * 86_400,
  '1mo': 31 * 86_400,
  '3mo': 93 * 86_400,
  '6mo': 186 * 86_400,
  '1y': 366 * 86_400,
  '5y': 5 * 366 * 86_400,
};

const INTERVAL_SECONDS: Record<ChartInterval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '1d': 86_400,
  '1w': 7 * 86_400,
  '1mo': 31 * 86_400,
};

function limitFor(interval: ChartInterval, range: ChartRange): number {
  if (range === 'max') return 2000;
  return Math.min(2000, Math.max(20, Math.ceil((RANGE_SECONDS[range] / INTERVAL_SECONDS[interval]) * 1.5)));
}

async function buildChart(symbol: string, interval: ChartInterval, range: ChartRange) {
  const bars = await fetchCsxChartBars(symbol, interval, limitFor(interval, range));
  const latestTime = bars.at(-1)?.time ?? 0;
  const visibleBars = range === 'max'
    ? bars
    : bars.filter((bar) => bar.time >= latestTime - RANGE_SECONDS[range]);
  return {
    symbol: symbol.toUpperCase(),
    interval,
    range,
    bars: visibleBars.map((bar) => ({
      time: new Date(bar.time * 1000).toISOString(),
      timestamp: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      value: bar.value,
    })),
    source: {
      code: 'csx.trade_chart',
      name: 'CSX Trade chart feed',
      url: 'https://trade.csx.com.kh/',
    },
    fetchedAt: new Date().toISOString(),
  };
}

export async function getChart(symbol: string, interval: ChartInterval, range: ChartRange) {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);

  const key = `${company.symbol}:${interval}:${range}`;
  const cached = chartCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await buildChart(company.symbol, interval, range);
  chartCache.set(key, { expiresAt: Date.now() + 20_000, value });
  return value;
}

export type QuickReadSignal = 'wait' | 'balanced' | 'strength' | 'caution' | 'unavailable';

export interface StockQuickRead {
  symbol: string;
  asOf: string | null;
  signal: QuickReadSignal;
  signalLabel: string;
  headline: string;
  explanation: string;
  session: {
    last: number | null;
    open: number | null;
    low: number | null;
    high: number | null;
    vwap: number | null;
    volume: number | null;
    value: number | null;
    rangePositionPct: number | null;
    vsVwapPct: number | null;
  };
  trend: {
    ma20: number | null;
    ma50: number | null;
    recentLow20: number | null;
    recentHigh20: number | null;
    label: 'uptrend' | 'downtrend' | 'mixed' | 'insufficient_data';
  };
  activity: {
    averageVolume20: number | null;
    averageValue20: number | null;
    volumeVsAveragePct: number | null;
    liquidityLabel: 'active' | 'moderate' | 'thin' | 'unknown';
  };
  priceReferences: Array<{
    key: 'session_low' | 'vwap' | 'session_high';
    label: string;
    price: number;
    note: string;
  }>;
  checklist: string[];
  disclaimer: string;
  source: { code: string; name: string; url: string };
  fetchedAt: string;
}

const cambodiaDate = (timestamp: number): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Phnom_Penh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(timestamp * 1000));

const average = (values: number[]): number | null => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;

function sessionFromBars(bars: CsxChartBar[]) {
  const lastBar = bars.at(-1);
  if (!lastBar) return null;
  const asOf = cambodiaDate(lastBar.time);
  const sessionBars = bars.filter((bar) => cambodiaDate(bar.time) === asOf);
  const volume = sessionBars.reduce((sum, bar) => sum + Math.max(0, bar.volume), 0);
  const value = sessionBars.reduce((sum, bar) => sum + Math.max(0, bar.value), 0);
  const low = Math.min(...sessionBars.map((bar) => bar.low));
  const high = Math.max(...sessionBars.map((bar) => bar.high));
  const last = lastBar.close;
  const vwap = volume > 0 && value > 0 ? value / volume : null;
  return {
    asOf,
    last,
    open: sessionBars[0]!.open,
    low,
    high,
    vwap,
    volume,
    value,
    rangePositionPct: high > low ? ((last - low) / (high - low)) * 100 : 50,
    vsVwapPct: vwap && vwap > 0 ? ((last - vwap) / vwap) * 100 : null,
  };
}

function quickReadMessage(input: {
  rangePositionPct: number;
  vsVwapPct: number | null;
  trend: StockQuickRead['trend']['label'];
}): Pick<StockQuickRead, 'signal' | 'signalLabel' | 'headline' | 'explanation'> {
  const { rangePositionPct, vsVwapPct, trend } = input;
  if (rangePositionPct >= 80) {
    return {
      signal: 'caution',
      signalLabel: 'Chasing risk',
      headline: 'Price is near the session high. Avoid chasing it with a market order.',
      explanation: 'A limit order near a price you accept gives you control, but it may not execute. Check the live best ask before buying.',
    };
  }
  if (rangePositionPct <= 20) {
    return {
      signal: 'wait',
      signalLabel: 'Wait for confirmation',
      headline: 'Price is near the session low. Cheap-looking can still become cheaper.',
      explanation: 'Wait for price and volume to stabilize, and check the live best bid and ask before deciding.',
    };
  }
  if (vsVwapPct !== null && Math.abs(vsVwapPct) <= 0.5) {
    return {
      signal: 'balanced',
      signalLabel: 'Near average',
      headline: 'Price is close to today\'s volume-weighted average.',
      explanation: 'This is a neutral intraday reference, not a forecast. Compare it with the live best ask before buying or best bid before selling.',
    };
  }
  if (vsVwapPct !== null && vsVwapPct > 0.5 && trend === 'uptrend') {
    return {
      signal: 'strength',
      signalLabel: 'Strength visible',
      headline: 'Price is above today\'s average and the medium-term trend is positive.',
      explanation: 'Momentum is visible, but use a limit price and avoid committing too much to one thinly traded stock.',
    };
  }
  return {
    signal: 'wait',
    signalLabel: 'Mixed setup',
    headline: 'Price, trend and activity do not give a clear setup yet.',
    explanation: 'Waiting is a valid decision. Use the range and VWAP as references, then check the live order book before placing an order.',
  };
}

/**
 * A deliberately small, educational decision aid. It describes current price
 * behaviour and never claims to know the next executable or future price.
 */
export async function getQuickRead(symbol: string): Promise<StockQuickRead> {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);

  const [minuteBars, rawQuotes] = await Promise.all([
    fetchCsxChartBars(company.symbol, '1m', 700),
    marketRepository.quoteHistory(company.id),
  ]);
  const fetchedAt = new Date().toISOString();
  const session = sessionFromBars(minuteBars);
  const quotes = rawQuotes.map(toQuotePoint);
  const recent20 = quotes.slice(-20);
  const recent50 = quotes.slice(-50);
  const closes20 = recent20.map((quote) => quote.close);
  const closes50 = recent50.map((quote) => quote.close);
  const ma20 = average(closes20);
  const ma50 = average(closes50);
  const averageVolume20 = average(recent20.flatMap((quote) => quote.volume === null ? [] : [quote.volume]));
  const averageValue20 = average(recent20.flatMap((quote) => quote.value === null ? [] : [quote.value]));
  const trend: StockQuickRead['trend']['label'] = ma20 === null || ma50 === null
    ? 'insufficient_data'
    : ma20 > ma50 * 1.005
      ? 'uptrend'
      : ma20 < ma50 * 0.995
        ? 'downtrend'
        : 'mixed';
  const liquidityLabel: StockQuickRead['activity']['liquidityLabel'] = averageValue20 === null
    ? 'unknown'
    : averageValue20 >= 1_000_000_000
      ? 'active'
      : averageValue20 >= 100_000_000
        ? 'moderate'
        : 'thin';

  if (!session) {
    return {
      symbol: company.symbol,
      asOf: null,
      signal: 'unavailable',
      signalLabel: 'No session data',
      headline: 'No intraday trade is available for a price reference.',
      explanation: 'Check the broker order book and try again when the market has trade data.',
      session: { last: null, open: null, low: null, high: null, vwap: null, volume: null, value: null, rangePositionPct: null, vsVwapPct: null },
      trend: { ma20, ma50, recentLow20: closes20.length ? Math.min(...closes20) : null, recentHigh20: closes20.length ? Math.max(...closes20) : null, label: trend },
      activity: { averageVolume20, averageValue20, volumeVsAveragePct: null, liquidityLabel },
      priceReferences: [],
      checklist: ['Check the broker\'s best bid and best ask.', 'Set the maximum amount you can afford to lose.', 'Prefer a limit order when price matters.'],
      disclaimer: 'Educational market context only—not personal investment advice or a prediction.',
      source: { code: 'csx.trade_chart', name: 'CSX Trade chart feed', url: 'https://trade.csx.com.kh/' },
      fetchedAt,
    };
  }

  const message = quickReadMessage({
    rangePositionPct: session.rangePositionPct,
    vsVwapPct: session.vsVwapPct,
    trend,
  });
  return {
    symbol: company.symbol,
    asOf: session.asOf,
    ...message,
    session,
    trend: {
      ma20,
      ma50,
      recentLow20: closes20.length ? Math.min(...closes20) : null,
      recentHigh20: closes20.length ? Math.max(...closes20) : null,
      label: trend,
    },
    activity: {
      averageVolume20,
      averageValue20,
      volumeVsAveragePct: averageVolume20 && averageVolume20 > 0
        ? (session.volume / averageVolume20) * 100
        : null,
      liquidityLabel,
    },
    priceReferences: [
      { key: 'session_low', label: 'Session low', price: session.low, note: 'Lower edge traded in the latest session—not guaranteed support.' },
      ...(session.vwap === null ? [] : [{ key: 'vwap' as const, label: 'Today\'s average', price: session.vwap, note: 'Volume-weighted average of recorded trades—not the current ask.' }]),
      { key: 'session_high', label: 'Session high', price: session.high, note: 'Upper edge traded in the latest session; buying near it raises chasing risk.' },
    ],
    checklist: [
      'Check the broker\'s live best ask before buying and best bid before selling.',
      'Use a limit order when the execution price matters; it may not fill.',
      'Choose position size and maximum acceptable loss before submitting the order.',
    ],
    disclaimer: 'Educational market context only—not personal investment advice, a fair-value estimate, or a price prediction.',
    source: { code: 'csx.trade_chart', name: 'CSX Trade chart feed', url: 'https://trade.csx.com.kh/' },
    fetchedAt,
  };
}

export async function getPeriods(symbol: string): Promise<(PeriodPoint & { source: unknown })[]> {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);
  const rows = await marketRepository.companyPeriods(company.id);
  return rows.map((row) => ({
    label: row.label,
    periodStart: toDateString(row.periodStart)!,
    periodEnd: toDateString(row.periodEnd)!,
    marketCap: toNumber(row.marketCapKhr),
    tradingVolume: toNumber(row.tradingVolume),
    tradingValue: toNumber(row.tradingValueKhr),
    dailyAvgVolume: toNumber(row.dailyAvgVolume),
    dailyAvgValue: toNumber(row.dailyAvgValueKhr),
    source: { code: row.sourceCode, datasetId: row.sourceDatasetId, url: row.sourceUrl },
  }));
}

export async function getDividends(symbol: string) {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);
  const rows = await repository.dividendsFor(company.id);
  return rows.map((row) => ({
    fiscalYear: row.fiscalYear,
    type: row.dividendType,
    amountPerShare: toNumber(row.amountPerShareKhr)!,
    exDate: toDateString(row.exDate),
    recordDate: toDateString(row.recordDate),
    paymentDate: toDateString(row.paymentDate),
    source: { code: row.sourceCode, url: row.sourceUrl },
  }));
}

/**
 * Peer context for the analysis engine.
 *
 * Median ratios come from the same session as the stock being analysed, so a
 * comparison is always like for like, and the index return covers exactly the
 * window RielVest has price history for.
 */
async function buildMarketContext(quotes: QuotePoint[]): Promise<MarketContext> {
  const tradeDate = await marketRepository.latestTradeDate();
  const sessionQuotes = tradeDate ? await marketRepository.quotesOn(tradeDate) : [];

  const pes = sessionQuotes
    .map((quote) => toNumber(quote.pe))
    .filter((pe): pe is number => pe !== null && pe > 0);
  const pbs = sessionQuotes
    .map((quote) => toNumber(quote.pb))
    .filter((pb): pb is number => pb !== null && pb > 0);
  const values = sessionQuotes
    .map((quote) => toNumber(quote.valueKhr))
    .filter((value): value is number => value !== null);

  const indexRows = await marketRepository.indexHistory('CSX');
  const windowSessions = Math.min(quotes.length, indexRows.length);
  const indexWindow = indexRows.slice(-windowSessions);
  const indexReturnPct =
    indexWindow.length >= 2
      ? pctChange(toNumber(indexWindow[0]!.value), toNumber(indexWindow.at(-1)!.value))
      : null;

  return {
    medianPe: median(pes),
    medianPb: median(pbs),
    medianDailyValue: median(values),
    totalDailyValue: values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null,
    indexReturnPct,
    indexWindowSessions: windowSessions,
  };
}

/** Assembles everything the engine needs for one company. */
export async function buildAnalysisInput(symbol: string): Promise<AnalysisInput> {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);

  const [rawQuotes, periodRows, dividendRows, financialRows] = await Promise.all([
    marketRepository.quoteHistory(company.id),
    marketRepository.companyPeriods(company.id),
    repository.dividendsFor(company.id),
    repository.financialsFor(company.id),
  ]);

  const quotes = rawQuotes.map(toQuotePoint);

  return {
    symbol: company.symbol,
    name: company.name,
    board: company.board,
    sector: company.sector,
    listingDate: toDateString(company.listingDate),
    quotes,
    periods: periodRows.map((row) => ({
      label: row.label,
      periodStart: toDateString(row.periodStart)!,
      periodEnd: toDateString(row.periodEnd)!,
      marketCap: toNumber(row.marketCapKhr),
      tradingVolume: toNumber(row.tradingVolume),
      tradingValue: toNumber(row.tradingValueKhr),
      dailyAvgVolume: toNumber(row.dailyAvgVolume),
      dailyAvgValue: toNumber(row.dailyAvgValueKhr),
    })),
    dividends: dividendRows.map((row) => ({
      fiscalYear: row.fiscalYear,
      amountPerShare: toNumber(row.amountPerShareKhr)!,
      paymentDate: toDateString(row.paymentDate),
    })),
    financials: financialRows.map((row) => ({
      fiscalYear: row.fiscalYear,
      fiscalPeriod: row.fiscalPeriod,
      revenue: toNumber(row.revenue),
      netIncome: toNumber(row.netIncome),
      totalEquity: toNumber(row.totalEquity),
      totalDebt: toNumber(row.totalDebt),
      totalAssets: toNumber(row.totalAssets),
      operatingCashFlow: toNumber(row.operatingCashFlow),
    })),
    market: await buildMarketContext(quotes),
  };
}

export async function analyse(symbol: string): Promise<StockAnalysis> {
  return analyseStock(await buildAnalysisInput(symbol));
}

export interface NarratedAnalysis extends StockAnalysis {
  /**
   * Where the prose came from. `engine` means the deterministic sentences —
   * either no model is configured, or its output failed the number check.
   */
  narrativeSource: 'model' | 'engine';
  narrativeModel: string | null;
}

/**
 * The analysis with its plain-language summary attached.
 *
 * The summary is read from the cache written during ingestion, never generated
 * here: a page load must not wait on a model, and it must not fail because a
 * model is rate-limited. A missing row simply means the engine's own sentences
 * are used, which is the same text the model would have been rewriting.
 */
export async function analyseWithNarrative(
  symbol: string,
  language: 'en' | 'km' = 'en',
): Promise<NarratedAnalysis> {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);

  const analysis = analyseStock(await buildAnalysisInput(symbol));
  if (!analysis.asOf) {
    return { ...analysis, narrativeSource: 'engine', narrativeModel: null };
  }

  const stored = await prisma.aiNarrative.findUnique({
    where: {
      companyId_tradeDate_language: {
        companyId: company.id,
        tradeDate: toDateColumn(analysis.asOf)!,
        language,
      },
    },
    select: { lines: true, source: true, model: true },
  });

  if (!stored || stored.lines.length === 0 || stored.source !== 'model') {
    return { ...analysis, narrativeSource: 'engine', narrativeModel: null };
  }

  return {
    ...analysis,
    narrative: stored.lines,
    narrativeSource: 'model',
    narrativeModel: stored.model,
  };
}

/** Runs the engine over several tickers for the comparison view. */
export async function compare(symbols: string[]): Promise<StockAnalysis[]> {
  const found = await repository.findManyBySymbols(symbols);
  const bySymbol = new Map(found.map((company) => [company.symbol, company]));
  const missing = symbols
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => !bySymbol.has(symbol));
  if (missing.length > 0) {
    throw notFound(`No listed company with the ticker ${missing.join(', ')}.`);
  }
  return Promise.all(found.map((company) => analyse(company.symbol)));
}

export { priceReturnPct };

/** Daily bars in the shape the indicator layer expects. */
function toBars(quotes: QuotePoint[]): Bar[] {
  return quotes.map((quote) => ({
    tradeDate: quote.tradeDate,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.close,
    volume: quote.volume,
    value: quote.value,
  }));
}

/**
 * The price levels worth watching for one stock.
 *
 * Recomputed from the recorded sessions on every request, so the card moves the
 * moment a new session lands rather than being pinned to whenever it was built.
 */
export async function getPriceLevels(symbol: string): Promise<PriceLevels> {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);
  const quotes = await marketRepository.quoteHistory(company.id);
  return buildPriceLevels(company.symbol, toBars(quotes.map(toQuotePoint)));
}

export { toBars };

/**
 * The prices that matter for one stock today.
 *
 * Recomputed per request from the recorded sessions, so the card moves with the
 * market rather than being pinned to whenever it was generated.
 */
export async function getTradePlan(symbol: string): Promise<TradePlan> {
  const company = await repository.findBySymbol(symbol);
  if (!company) throw notFound(`No listed company with the ticker ${symbol.toUpperCase()}.`);
  const quotes = await marketRepository.quoteHistory(company.id);
  return buildTradePlan(company.symbol, toBars(quotes.map(toQuotePoint)));
}
