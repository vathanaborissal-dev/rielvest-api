import { toDateColumn } from '../../core/decimal.ts';
import { logger } from '../../core/logger.ts';
import { parseGrouped } from '../../core/num.ts';
import { prisma } from '../../core/prisma.ts';
import { fetchTradeSummary, parseCsxDayFirst, type CsxTradeRow } from '../csxWebClient.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:csx-trade-summary');

/** CSX reports the move as a magnitude plus a direction word. */
function signedChange(row: CsxTradeRow): number | null {
  if (row.change === null || row.change === undefined) return null;
  const magnitude = Math.abs(row.change);
  if (row.changeUpDown === 'down') return -magnitude;
  if (row.changeUpDown === 'up') return magnitude;
  return 0;
}

/**
 * Records the exchange's official end-of-session summary.
 *
 * This is RielVest's primary daily price source. It supersedes the copy on the
 * open-data portal for two reasons: it states the session date explicitly, and
 * it covers all twelve listed issuers rather than the eleven the portal mirrors.
 *
 * Because the session date comes from the payload, re-running after the close
 * updates that session rather than writing today's date over a stale copy of
 * yesterday's numbers.
 */
export async function ingestCsxTradeSummary(): Promise<IngestResult> {
  const summary = await fetchTradeSummary();
  const rows = summary.auctionTradingMethod ?? [];

  const sessionDate = parseCsxDayFirst(summary.marketClosingData?.date ?? summary.date);
  if (!sessionDate) {
    return {
      rowsRead: rows.length,
      rowsWritten: 0,
      rowsSkipped: rows.length,
      warnings: [
        'CSX returned a trade summary with no session date. Nothing was recorded, because a price ' +
          'filed under the wrong day is worse than no price at all.',
      ],
    };
  }

  const tradeDate = toDateColumn(sessionDate)!;
  const warnings: string[] = [];
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    const symbol = row.stock?.trim();
    if (!symbol) {
      skipped += 1;
      continue;
    }

    const company = await prisma.company.findUnique({
      where: { symbol },
      select: { id: true, isin: true },
    });
    if (!company) {
      warnings.push(
        `CSX reported ticker ${symbol}, which is not in the company register. Add it to the reference seed.`,
      );
      skipped += 1;
      continue;
    }

    if (row.icode && company.isin !== row.icode) {
      await prisma.company.update({ where: { id: company.id }, data: { isin: row.icode } });
    }

    const closeKhr = parseGrouped(row.close);
    if (closeKhr === null) {
      // An issuer with no trades in the session has no close to record.
      skipped += 1;
      continue;
    }

    const volume = parseGrouped(row.volume);
    const data = {
      openKhr: parseGrouped(row.open),
      highKhr: parseGrouped(row.high),
      lowKhr: parseGrouped(row.low),
      closeKhr,
      changeKhr: signedChange(row),
      volume: volume === null ? null : BigInt(Math.round(volume)),
      valueKhr: parseGrouped(row.value),
      // "-" means CSX reports no meaningful ratio, which is not zero.
      pe: parseGrouped(row.pe),
      pb: parseGrouped(row.pb),
      // The feed returns 0 for every issuer, indistinguishable from "not
      // disclosed". Dividend history comes from the disclosure archive instead.
      dividendKhr: null,
      capturedAt: new Date(),
      sourceCode: SOURCES.CSX_TRADE_SUMMARY,
    };

    await prisma.stockQuote.upsert({
      where: { companyId_tradeDate: { companyId: company.id, tradeDate } },
      create: { companyId: company.id, tradeDate, ...data },
      update: data,
    });
    written += 1;
  }

  log.info(`recorded ${written} quotes for session ${sessionDate} (${skipped} skipped)`);
  return {
    rowsRead: rows.length,
    rowsWritten: written,
    rowsSkipped: skipped,
    warnings,
    detail: { sessionDate, symbols: rows.map((row) => row.stock).filter(Boolean) },
  };
}

export const csxTradeSummaryAdapter: Adapter = {
  key: 'csx-trade-summary',
  sourceCode: SOURCES.CSX_TRADE_SUMMARY,
  title: 'CSX official daily trade summary',
  run: ingestCsxTradeSummary,
};
