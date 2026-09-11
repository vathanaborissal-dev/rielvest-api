import { toDateColumn } from '../../core/decimal.ts';
import { logger } from '../../core/logger.ts';
import { parseGrouped } from '../../core/num.ts';
import { prisma } from '../../core/prisma.ts';
import { fetchIndexHistory } from '../csxWebClient.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:csx-index-history');

/** CSX publishes exchange-wide capitalisation in millions of riel. */
const MILLION = 1_000_000;

/** Converts the exchange's "10/09/2026" day-first format to an ISO date. */
function parseCsxDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

/**
 * Backfills the CSX index from the exchange's own archive.
 *
 * The MEF real-time feed exposes only the current session, so before this
 * adapter RielVest had no index history to compare a stock against. CSX's site
 * publishes every session since the market opened in April 2012, along with the
 * exchange-wide market capitalisation and turnover for each day.
 */
export async function ingestCsxIndexHistory(): Promise<IngestResult> {
  // Cambodia's market opened in 2012; starting earlier simply returns nothing.
  const rows = await fetchIndexHistory('20120101', new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const warnings: string[] = [];
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    const tradeDate = parseCsxDate(row.date);
    if (!tradeDate || row.value === null) {
      skipped += 1;
      continue;
    }

    const sign = row.changeUpDown === 'down' ? -1 : 1;
    const totalVolume = parseGrouped(row.totalTradingVolume);
    const marketCap = parseGrouped(row.marketCap);

    const data = {
      value: row.value,
      // The archive reports the percentage move but not the absolute one, so
      // the absolute change is left null rather than reconstructed.
      changePercent: row.changePercent === null ? null : sign * Math.abs(row.changePercent),
      open: row.opening,
      high: row.high,
      low: row.low,
      marketCapKhr: marketCap === null ? null : marketCap * MILLION,
      totalVolume: totalVolume === null ? null : BigInt(Math.round(totalVolume)),
      totalValueKhr: parseGrouped(row.totalTradingValue),
      sourceCode: SOURCES.CSX_INDEX_HISTORY,
    };

    await prisma.indexQuote.upsert({
      where: { indexCode_tradeDate: { indexCode: 'CSX', tradeDate: toDateColumn(tradeDate)! } },
      create: { indexCode: 'CSX', tradeDate: toDateColumn(tradeDate)!, ...data },
      // The live MEF feed carries the absolute change and the session marker,
      // so a backfill must not blank those on a day it already recorded.
      update: data,
    });
    written += 1;
  }

  log.info(`recorded ${written} index sessions (${skipped} skipped)`);
  return {
    rowsRead: rows.length,
    rowsWritten: written,
    rowsSkipped: skipped,
    warnings,
    detail: { earliest: parseCsxDate(rows.at(-1)?.date ?? null), latest: parseCsxDate(rows[0]?.date ?? null) },
  };
}

export const csxIndexHistoryAdapter: Adapter = {
  key: 'csx-index-history',
  sourceCode: SOURCES.CSX_INDEX_HISTORY,
  title: 'CSX index history',
  run: ingestCsxIndexHistory,
};
