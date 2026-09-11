import { toDateColumn } from '../../core/decimal.ts';
import { logger } from '../../core/logger.ts';
import { parseGrouped } from '../../core/num.ts';
import { prisma } from '../../core/prisma.ts';
import { fetchTradeSummary, parseCsxDayFirst } from '../csxWebClient.ts';
import { fetchCsxSummary, type CsxSummaryRow } from '../mefClient.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:csx-summary');

/**
 * CSX reports the session's move as a magnitude plus a direction word.
 * Recombining them into a signed number here means no downstream code has to.
 */
function signedChange(row: CsxSummaryRow): number | null {
  if (row.change === null || row.change === undefined) return null;
  const magnitude = Math.abs(row.change);
  if (row.change_up_down === 'down') return -magnitude;
  if (row.change_up_down === 'up') return magnitude;
  return 0;
}

/**
 * Records the open-data portal's mirror of the CSX trade summary.
 *
 * This is a secondary source: the exchange's own feed is primary. It is kept
 * because an independent copy of the same session is a genuine cross-check, and
 * because the portal is the citable public record for Cambodian market data.
 *
 * The portal's payload carries **no session date** — only the timestamp at
 * which it was last refreshed. Deriving the trade date from that timestamp is
 * what silently filed a re-served copy of the previous close under today's
 * date, inventing a phantom session in which every stock closed exactly where
 * it had the day before. The session date is therefore taken from the exchange,
 * and when that is unavailable nothing is written at all.
 */
export async function ingestCsxSummary(): Promise<IngestResult> {
  const body = await fetchCsxSummary();
  const rows = body.data ?? [];
  const warnings: string[] = [];
  let written = 0;
  let skipped = 0;

  const exchangeSummary = await fetchTradeSummary();
  const sessionDate = parseCsxDayFirst(
    exchangeSummary.marketClosingData?.date ?? exchangeSummary.date,
  );
  if (!sessionDate) {
    return {
      rowsRead: rows.length,
      rowsWritten: 0,
      rowsSkipped: rows.length,
      warnings: [
        'The open-data portal publishes no session date, and the exchange did not report one ' +
          'either, so this mirror could not be filed against a session. Nothing was recorded.',
      ],
    };
  }
  const tradeDate = toDateColumn(sessionDate)!;

  for (const row of rows) {
    const symbol = (row.stock ?? row.name ?? '').trim();
    if (!symbol) {
      skipped += 1;
      continue;
    }

    const company = await prisma.company.findUnique({
      where: { symbol },
      select: { id: true, isin: true },
    });

    if (!company) {
      // A new listing appeared upstream before our register knew about it. Say
      // so loudly rather than inventing a company row with no descriptive facts.
      warnings.push(
        `CSX reported ticker ${symbol}, which is not in the company register. Add it to the reference seed.`,
      );
      skipped += 1;
      continue;
    }

    // The feed carries the real ISIN; adopt it when ours is missing or stale.
    if (row.icode && company.isin !== row.icode) {
      await prisma.company.update({ where: { id: company.id }, data: { isin: row.icode } });
    }

    const closeKhr = parseGrouped(row.close);
    if (closeKhr === null) {
      warnings.push(`${symbol} had no closing price in this session; nothing recorded.`);
      skipped += 1;
      continue;
    }

    const quote = {
      openKhr: parseGrouped(row.open_price),
      highKhr: parseGrouped(row.high),
      lowKhr: parseGrouped(row.low),
      closeKhr,
      changeKhr: signedChange(row),
      volume: (() => {
        const value = parseGrouped(row.volume);
        return value === null ? null : BigInt(Math.round(value));
      })(),
      valueKhr: parseGrouped(row.value),
      // CSX writes "-" for issuers with no meaningful ratio (typically a
      // loss-maker); keeping that as null is different from claiming zero.
      pe: parseGrouped(row.pe),
      pb: parseGrouped(row.pb),
      // The feed currently returns 0 for every issuer, which is
      // indistinguishable from "not disclosed". Treat zero as absent rather
      // than as a real payout of nothing.
      dividendKhr: row.dividend && row.dividend > 0 ? row.dividend : null,
      capturedAt: new Date(),
      sourceCode: SOURCES.CSX_SUMMARY,
    };

    await prisma.stockQuote.upsert({
      where: { companyId_tradeDate: { companyId: company.id, tradeDate } },
      create: { companyId: company.id, tradeDate, ...quote },
      update: quote,
    });
    written += 1;
  }

  log.info(`recorded ${written} quotes for session ${sessionDate} (${skipped} skipped)`);
  return {
    rowsRead: rows.length,
    rowsWritten: written,
    rowsSkipped: skipped,
    warnings,
    detail: { sessionDate, symbols: rows.map((r) => r.stock).filter(Boolean) },
  };
}

export const csxSummaryAdapter: Adapter = {
  key: 'csx-summary',
  sourceCode: SOURCES.CSX_SUMMARY,
  title: 'CSX daily trade summary',
  run: ingestCsxSummary,
};
