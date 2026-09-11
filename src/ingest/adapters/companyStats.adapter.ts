import { toDateColumn } from '../../core/decimal.ts';
import { quarterBounds } from '../../core/dates.ts';
import { logger } from '../../core/logger.ts';
import { prisma } from '../../core/prisma.ts';
import { discoverDatasets } from '../discovery.ts';
import { datasetPageUrl, fetchDatasetFile } from '../mefClient.ts';
import { parseQuarterTable, type MetricSpec } from '../parsers/quarterTable.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:company-stats');

const MILLION = 1_000_000;

type MeasureField =
  | 'marketCapKhr'
  | 'tradingVolume'
  | 'tradingValueKhr'
  | 'dailyAvgVolume'
  | 'dailyAvgValueKhr';

/**
 * Every spelling of these metrics seen across the SERC exports, in normalised
 * form. USD columns are deliberately ignored: they are the publisher's own
 * conversion at an unstated rate, and RielVest converts from riel itself using
 * the NBC rate for the day it displays.
 */
const METRICS: Record<string, MetricSpec<MeasureField>> = {
  marketcapmilkhr: { field: 'marketCapKhr', scale: MILLION },
  tradingvolumeshares: { field: 'tradingVolume', scale: 1 },
  tradingvolumemilshares: { field: 'tradingVolume', scale: MILLION },
  dailyaverageoftradingvolumeshares: { field: 'dailyAvgVolume', scale: 1 },
  tradingvaluemilkhr: { field: 'tradingValueKhr', scale: MILLION },
  dailyaverageoftradingvaluemilkhr: { field: 'dailyAvgValueKhr', scale: MILLION },
};

/** Dataset titles carry zero-width joiners between words; strip them first. */
const clean = (title: string): string => title.replace(/[​-‍﻿]/g, '');

/** Extracts the ticker from titles like "Trading Overview of … (PPAP) of 2024". */
function symbolFromTitle(title: string): string | null {
  const matches = [...clean(title).matchAll(/\(([A-Z]{2,6})\)/g)].map((match) => match[1]!);
  return matches.at(-1) ?? null;
}

function yearFromTitle(title: string): number | null {
  const match = /of\s+(20\d{2})\s*$/.exec(clean(title).trim());
  return match ? Number(match[1]) : null;
}

/**
 * Imports SERC's per-issuer quarterly trading statistics.
 *
 * These are reported figures — notably market capitalisation, which RielVest
 * cannot compute itself because no Cambodian source publishes per-company share
 * counts. Showing SERC's reported figure is honest; multiplying a price by a
 * guessed share count would not be.
 */
export async function ingestCompanyStats(): Promise<IngestResult> {
  const datasets = await discoverDatasets([
    'Trading Overview of',
    'Trading Information of Equity of',
  ]);

  const warnings: string[] = [];
  let read = 0;
  let written = 0;
  let skipped = 0;

  for (const dataset of datasets) {
    if ((dataset.format ?? '').toUpperCase() !== 'CSV') {
      skipped += 1;
      continue;
    }

    const symbol = symbolFromTitle(dataset.name);
    const year = yearFromTitle(dataset.name);
    if (!symbol || year === null) {
      warnings.push(`Could not read a ticker and year from "${dataset.name}"; skipped.`);
      skipped += 1;
      continue;
    }

    const company = await prisma.company.findUnique({ where: { symbol }, select: { id: true } });
    if (!company) {
      warnings.push(`"${dataset.name}" names ticker ${symbol}, which is not in the register.`);
      skipped += 1;
      continue;
    }

    let quarters;
    try {
      quarters = parseQuarterTable(await fetchDatasetFile(dataset.id), METRICS, year);
      read += 1;
    } catch (error) {
      warnings.push(`${dataset.name}: ${error instanceof Error ? error.message : String(error)}`);
      skipped += 1;
      continue;
    }

    if (quarters.length === 0) {
      warnings.push(`No quarterly figures could be read from "${dataset.name}".`);
      skipped += 1;
      continue;
    }

    for (const record of quarters) {
      const bounds = quarterBounds(record.year, record.quarter);
      const periodStart = toDateColumn(bounds.start)!;
      const shared = {
        periodEnd: toDateColumn(bounds.end)!,
        label: `Q${record.quarter} ${record.year}`,
        // Only measures the export actually carries are written, so a partial
        // re-import never blanks a figure an earlier export supplied.
        ...record.measures,
        sourceCode: SOURCES.SERC_COMPANY_TRADING,
        sourceDatasetId: dataset.id,
        sourceUrl: datasetPageUrl(dataset.id),
        importedAt: new Date(),
      };

      await prisma.companyPeriodStat.upsert({
        where: {
          companyId_periodType_periodStart: {
            companyId: company.id,
            periodType: 'quarter',
            periodStart,
          },
        },
        create: { companyId: company.id, periodType: 'quarter', periodStart, ...shared },
        update: shared,
      });
      written += 1;
    }
  }

  log.info(`imported ${written} company-quarter rows from ${read} datasets`);
  return { rowsRead: read, rowsWritten: written, rowsSkipped: skipped, warnings };
}

export const companyStatsAdapter: Adapter = {
  key: 'company-stats',
  sourceCode: SOURCES.SERC_COMPANY_TRADING,
  title: 'Per-company quarterly trading statistics',
  run: ingestCompanyStats,
};
