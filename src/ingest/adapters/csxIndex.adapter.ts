import { toDateColumn } from '../../core/decimal.ts';
import { parseSlashDate, toCambodiaDate } from '../../core/dates.ts';
import { logger } from '../../core/logger.ts';
import { prisma } from '../../core/prisma.ts';
import { fetchCsxIndex } from '../mefClient.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:csx-index');

/** Records the CSX composite index for the latest published session. */
export async function ingestCsxIndex(): Promise<IngestResult> {
  const body = await fetchCsxIndex();
  const row = body.data;
  if (!row || typeof row.value !== 'number') {
    return {
      rowsRead: 0,
      rowsWritten: 0,
      rowsSkipped: 1,
      warnings: ['The index feed returned no value.'],
    };
  }

  const tradeDate = toDateColumn(
    parseSlashDate(row.date) ?? toCambodiaDate(new Date(row.created_at)),
  )!;

  const sign = row.change_up_down === 'down' ? -1 : 1;
  const data = {
    value: row.value,
    change: row.change === null ? null : sign * Math.abs(row.change),
    changePercent: row.change_percent === null ? null : sign * Math.abs(row.change_percent),
    open: row.opening,
    high: row.high,
    low: row.low,
    indexTime: row.index_time,
    capturedAt: new Date(),
    sourceCode: SOURCES.CSX_INDEX,
  };

  await prisma.indexQuote.upsert({
    where: { indexCode_tradeDate: { indexCode: 'CSX', tradeDate } },
    create: { indexCode: 'CSX', tradeDate, ...data },
    update: data,
  });

  log.info(`recorded index ${row.value} for ${row.date}`);
  return {
    rowsRead: 1,
    rowsWritten: 1,
    rowsSkipped: 0,
    detail: { tradeDate: row.date, value: row.value },
  };
}

export const csxIndexAdapter: Adapter = {
  key: 'csx-index',
  sourceCode: SOURCES.CSX_INDEX,
  title: 'CSX composite index',
  run: ingestCsxIndex,
};
