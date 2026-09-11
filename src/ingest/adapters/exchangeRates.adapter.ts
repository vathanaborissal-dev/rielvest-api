import { toDateColumn } from '../../core/decimal.ts';
import { logger } from '../../core/logger.ts';
import { prisma } from '../../core/prisma.ts';
import { fetchExchangeRates } from '../mefClient.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:fx');

/** RielVest only ever displays riel figures alongside US dollars. */
const TRACKED = new Set(['USD']);

/**
 * Records the National Bank of Cambodia reference rate.
 *
 * Rates are quoted as "one unit of X equals N riel", so each stored row is
 * X to KHR, normalised to a per-one-unit rate.
 */
export async function ingestExchangeRates(): Promise<IngestResult> {
  const body = await fetchExchangeRates();
  const rows = body.data ?? [];
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!TRACKED.has(row.currency_id) || !row.valid_date) {
      skipped += 1;
      continue;
    }

    const average =
      row.average ?? (row.bid !== null && row.ask !== null ? (row.bid + row.ask) / 2 : null);
    if (average === null) {
      skipped += 1;
      continue;
    }

    const unit = row.unit && row.unit > 0 ? row.unit : 1;
    const rateDate = toDateColumn(row.valid_date)!;
    const data = {
      bid: row.bid === null ? null : row.bid / unit,
      ask: row.ask === null ? null : row.ask / unit,
      average: average / unit,
      capturedAt: new Date(),
      sourceCode: SOURCES.NBC_FX,
    };

    await prisma.fxRate.upsert({
      where: {
        baseCurrency_quoteCurrency_rateDate: {
          baseCurrency: row.currency_id,
          quoteCurrency: 'KHR',
          rateDate,
        },
      },
      create: { baseCurrency: row.currency_id, quoteCurrency: 'KHR', rateDate, ...data },
      update: data,
    });
    written += 1;
  }

  log.info(`recorded ${written} FX rates`);
  return { rowsRead: rows.length, rowsWritten: written, rowsSkipped: skipped };
}

export const exchangeRatesAdapter: Adapter = {
  key: 'exchange-rates',
  sourceCode: SOURCES.NBC_FX,
  title: 'NBC reference exchange rates',
  run: ingestExchangeRates,
};
