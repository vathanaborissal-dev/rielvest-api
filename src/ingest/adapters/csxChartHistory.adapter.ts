import { toDateColumn } from '../../core/decimal.ts';
import { toCambodiaDate } from '../../core/dates.ts';
import { logger } from '../../core/logger.ts';
import { prisma } from '../../core/prisma.ts';
import { fetchCsxChartBars } from '../csxChartClient.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:csx-chart');

/**
 * Daily bars from the chart feed behind trade.csx.com.kh.
 *
 * Two jobs, one adapter:
 *
 *  - **Backfill.** The feed serves every session back to each issuer's listing
 *    date, which is the only way to obtain CSX price history at all — every
 *    other feed exposes a single session with no date parameter.
 *  - **Keeping current.** It is also the *fastest* source. The exchange's
 *    official trade summary is published some hours after the close, so between
 *    the bell and that publication the chart feed is the only place today's
 *    session exists.
 *
 * Precedence: this adapter writes prices and volume, and never touches `pe`,
 * `pb` or `dividendKhr`. Those come from the official summary, which supersedes
 * this source for a session once CSX publishes it. That way the freshest
 * numbers appear immediately without overwriting the authoritative ones later.
 */
async function ingest(sessions: number): Promise<IngestResult> {
  const companies = await prisma.company.findMany({
    where: { status: 'listed' },
    select: { id: true, symbol: true },
    orderBy: { symbol: 'asc' },
  });

  const warnings: string[] = [];
  let rowsRead = 0;
  let rowsWritten = 0;
  let rowsSkipped = 0;

  for (const company of companies) {
    let bars;
    try {
      bars = await fetchCsxChartBars(company.symbol, '1d', sessions);
    } catch (error) {
      warnings.push(
        `${company.symbol}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    rowsRead += bars.length;

    // Existing sessions are looked up in one query rather than one per bar;
    // a backfill touches a couple of thousand bars per company.
    const existing = await prisma.stockQuote.findMany({
      where: { companyId: company.id },
      select: { tradeDate: true },
    });
    const known = new Set(existing.map((row) => row.tradeDate.toISOString().slice(0, 10)));

    const fresh: {
      companyId: string;
      tradeDate: Date;
      openKhr: number;
      highKhr: number;
      lowKhr: number;
      closeKhr: number;
      changeKhr: number | null;
      volume: bigint;
      valueKhr: number;
      sourceCode: string;
    }[] = [];

    for (const [index, bar] of bars.entries()) {
      const date = toCambodiaDate(new Date(bar.time * 1000));
      const previous = bars[index - 1];
      const row = {
        companyId: company.id,
        tradeDate: toDateColumn(date)!,
        openKhr: bar.open,
        highKhr: bar.high,
        lowKhr: bar.low,
        closeKhr: bar.close,
        // The feed states no change, so it is computed against the preceding
        // bar. The official summary's own figure replaces this when it lands.
        changeKhr: previous ? bar.close - previous.close : null,
        volume: BigInt(Math.round(bar.volume)),
        valueKhr: bar.value,
        sourceCode: SOURCES.CSX_TRADE_CHART,
      };

      if (known.has(date)) {
        // Refresh prices on a session we already hold, but leave the ratios and
        // the recorded source alone so an official summary is not downgraded.
        await prisma.stockQuote.update({
          where: { companyId_tradeDate: { companyId: company.id, tradeDate: row.tradeDate } },
          data: {
            openKhr: row.openKhr,
            highKhr: row.highKhr,
            lowKhr: row.lowKhr,
            closeKhr: row.closeKhr,
            volume: row.volume,
            valueKhr: row.valueKhr,
          },
        });
        rowsSkipped += 1;
      } else {
        fresh.push(row);
      }
    }

    if (fresh.length > 0) {
      const result = await prisma.stockQuote.createMany({ data: fresh, skipDuplicates: true });
      rowsWritten += result.count;
    }
    log.info(`${company.symbol}: read ${bars.length}, added ${fresh.length}`);
  }

  return {
    rowsRead,
    rowsWritten,
    rowsSkipped,
    warnings,
    detail: { companies: companies.length, sessionsRequested: sessions },
  };
}

/** Full backfill to each issuer's listing date. Run once, or after a gap. */
export const csxChartHistoryAdapter: Adapter = {
  key: 'csx-chart-history',
  sourceCode: SOURCES.CSX_TRADE_CHART,
  title: 'CSX historical daily bars (full backfill)',
  run: () => ingest(2000),
};

/** The recent window, cheap enough to run on every refresh. */
export const csxChartRecentAdapter: Adapter = {
  key: 'csx-chart-recent',
  sourceCode: SOURCES.CSX_TRADE_CHART,
  title: 'CSX daily bars (recent sessions)',
  run: () => ingest(10),
};
