import { prisma } from '../../core/prisma.ts';
import type { BoardScope, PeriodType, Prisma } from '../../generated/prisma/client.ts';

/** The most recent session RielVest has recorded any quote for. */
export async function latestTradeDate(): Promise<Date | null> {
  const row = await prisma.stockQuote.findFirst({
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  return row?.tradeDate ?? null;
}

/** The session before `date` that actually has quotes, if there is one. */
export async function previousTradeDate(date: Date): Promise<Date | null> {
  const row = await prisma.stockQuote.findFirst({
    where: { tradeDate: { lt: date } },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  return row?.tradeDate ?? null;
}

export type QuoteWithCompany = Prisma.StockQuoteGetPayload<{
  include: {
    company: {
      select: {
        id: true;
        symbol: true;
        name: true;
        sector: true;
        industry: true;
        board: true;
        listingDate: true;
      };
    };
  };
}>;

export function quotesOn(date: Date): Promise<QuoteWithCompany[]> {
  return prisma.stockQuote.findMany({
    where: { tradeDate: date },
    include: {
      company: {
        select: {
          id: true,
          symbol: true,
          name: true,
          sector: true,
          industry: true,
          board: true,
          listingDate: true,
        },
      },
    },
    orderBy: { company: { symbol: 'asc' } },
  });
}

/** Every recorded session for one company, oldest first. */
export function quoteHistory(companyId: string, since?: Date) {
  return prisma.stockQuote.findMany({
    where: { companyId, ...(since ? { tradeDate: { gte: since } } : {}) },
    orderBy: { tradeDate: 'asc' },
  });
}

/** Recorded sessions for every company at once, oldest first. */
export function allQuoteHistory(since?: Date) {
  return prisma.stockQuote.findMany({
    where: since ? { tradeDate: { gte: since } } : {},
    orderBy: { tradeDate: 'asc' },
    select: {
      companyId: true,
      tradeDate: true,
      closeKhr: true,
      volume: true,
      valueKhr: true,
      changeKhr: true,
      pe: true,
      pb: true,
    },
  });
}

export function latestIndexQuote(indexCode = 'CSX') {
  return prisma.indexQuote.findFirst({
    where: { indexCode },
    orderBy: { tradeDate: 'desc' },
  });
}

export function indexHistory(indexCode = 'CSX', since?: Date) {
  return prisma.indexQuote.findMany({
    where: { indexCode, ...(since ? { tradeDate: { gte: since } } : {}) },
    orderBy: { tradeDate: 'asc' },
  });
}

export function marketPeriods(options: {
  board?: BoardScope;
  periodType?: PeriodType;
  limit?: number;
}) {
  return prisma.marketPeriodStat.findMany({
    where: {
      board: options.board ?? 'all',
      periodType: options.periodType ?? 'quarter',
    },
    orderBy: { periodStart: 'asc' },
    ...(options.limit ? { take: options.limit } : {}),
  });
}

export function companyPeriods(companyId: string) {
  return prisma.companyPeriodStat.findMany({
    where: { companyId },
    orderBy: { periodStart: 'asc' },
  });
}

/** The latest USD reference rate on or before `date`. */
export function latestFxRate(base = 'USD', on?: Date) {
  return prisma.fxRate.findFirst({
    where: { baseCurrency: base, quoteCurrency: 'KHR', ...(on ? { rateDate: { lte: on } } : {}) },
    orderBy: { rateDate: 'desc' },
  });
}

export function recentEvents(limit = 20) {
  return prisma.marketEvent.findMany({
    orderBy: { eventDate: 'desc' },
    take: limit,
    include: { company: { select: { symbol: true, name: true } } },
  });
}

export function countListedCompanies(): Promise<number> {
  return prisma.company.count({ where: { status: 'listed' } });
}

/**
 * The most recently reported market capitalisation for each company.
 *
 * SERC publishes these quarterly per issuer. RielVest shows the regulator's
 * figure rather than multiplying price by a share count, because no Cambodian
 * source publishes per-company shares outstanding.
 */
export async function latestCompanyMarketCaps(): Promise<
  Map<string, { value: number; label: string; periodEnd: Date }>
> {
  const rows = await prisma.companyPeriodStat.findMany({
    where: { marketCapKhr: { not: null } },
    orderBy: { periodStart: 'asc' },
    select: { companyId: true, marketCapKhr: true, label: true, periodEnd: true },
  });

  // Ascending order means the last write per company is the most recent.
  const latest = new Map<string, { value: number; label: string; periodEnd: Date }>();
  for (const row of rows) {
    latest.set(row.companyId, {
      value: Number(row.marketCapKhr),
      label: row.label,
      periodEnd: row.periodEnd,
    });
  }
  return latest;
}

/**
 * Recent daily bars for every listed company in one round trip.
 *
 * The indicator layer needs at most ~250 sessions (the 200-day average and the
 * 52-week range), so the window is capped rather than pulling every bar ever
 * recorded for a dozen companies.
 */
export async function recentBarsByCompany(sessions = 260) {
  // A single cut-off date is enough: CSX sessions are shared across issuers, so
  // this yields roughly `sessions` bars each without a per-company query.
  const cutoff = new Date(Date.now() - Math.ceil(sessions * 1.5) * 86_400_000);

  const rows = await prisma.stockQuote.findMany({
    where: { tradeDate: { gte: cutoff } },
    orderBy: { tradeDate: 'asc' },
    select: {
      companyId: true,
      tradeDate: true,
      openKhr: true,
      highKhr: true,
      lowKhr: true,
      closeKhr: true,
      changeKhr: true,
      volume: true,
      valueKhr: true,
      pe: true,
      pb: true,
    },
  });

  const byCompany = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byCompany.get(row.companyId);
    if (bucket) bucket.push(row);
    else byCompany.set(row.companyId, [row]);
  }
  return byCompany;
}

export function listedCompanies() {
  return prisma.company.findMany({
    where: { status: 'listed' },
    select: { id: true, symbol: true, name: true, sector: true, board: true },
    orderBy: { symbol: 'asc' },
  });
}

/**
 * The most recently published P/E and P/B for each company, with the session
 * they belong to.
 *
 * CSX releases these in its end-of-session summary, which lands hours after the
 * bell, so the newest price routinely exists with no ratios attached. Carrying
 * the last published pair forward — labelled with its own date — keeps the
 * valuation columns populated without implying they describe today.
 */
export async function latestReportedRatios(): Promise<
  Map<string, { pe: number | null; pb: number | null; asOf: Date }>
> {
  const rows = await prisma.stockQuote.findMany({
    where: { OR: [{ pe: { not: null } }, { pb: { not: null } }] },
    orderBy: { tradeDate: 'asc' },
    select: { companyId: true, tradeDate: true, pe: true, pb: true },
  });

  // Ascending order means the last write per company is the most recent.
  const latest = new Map<string, { pe: number | null; pb: number | null; asOf: Date }>();
  for (const row of rows) {
    const current = latest.get(row.companyId);
    latest.set(row.companyId, {
      pe: row.pe === null ? (current?.pe ?? null) : Number(row.pe),
      pb: row.pb === null ? (current?.pb ?? null) : Number(row.pb),
      asOf: row.tradeDate,
    });
  }
  return latest;
}
