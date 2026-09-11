import { toDateColumn } from '../../core/decimal.ts';
import { quarterBounds } from '../../core/dates.ts';
import { logger } from '../../core/logger.ts';
import { parseGrouped } from '../../core/num.ts';
import { prisma } from '../../core/prisma.ts';
import { parseCsvRecords } from '../csv.ts';
import { discoverDatasets } from '../discovery.ts';
import { datasetPageUrl, fetchDatasetFile } from '../mefClient.ts';
import { normaliseKey, parseQuarterTable, type MetricSpec } from '../parsers/quarterTable.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';
import type { BoardScope } from '../../generated/prisma/client.ts';

const log = logger('ingest:market-stats');

const MILLION = 1_000_000;

type MeasureField =
  | 'tradingDays'
  | 'listedCompanies'
  | 'listedShares'
  | 'marketCapKhr'
  | 'tradingVolume'
  | 'tradingValueKhr'
  | 'dailyAvgVolume'
  | 'dailyAvgValueKhr'
  | 'buyOrderVolume'
  | 'sellOrderVolume'
  | 'indexClose'
  | 'investorCount';

/**
 * Every spelling of these metrics seen across the CSX and SERC exports, in
 * normalised form. USD columns are ignored on purpose: they are the publisher's
 * own conversion at an unstated rate, and RielVest converts from riel itself
 * using the NBC rate for the day it displays.
 */
const METRICS: Record<string, MetricSpec<MeasureField>> = {
  notradingdays: { field: 'tradingDays', scale: 1 },
  numbersoftradingdays: { field: 'tradingDays', scale: 1 },
  numberoftradingdays: { field: 'tradingDays', scale: 1 },
  nooflistingsstocks: { field: 'listedCompanies', scale: 1 },
  numbersoflistedsharesmilshares: { field: 'listedShares', scale: MILLION },
  marketcapitalizationkhr: { field: 'marketCapKhr', scale: 1 },
  marketcapmilkhr: { field: 'marketCapKhr', scale: MILLION },
  buyorderquantitymilshares: { field: 'buyOrderVolume', scale: MILLION },
  sellorderquantitymilshares: { field: 'sellOrderVolume', scale: MILLION },
  totaltradingvolumeshares: { field: 'tradingVolume', scale: 1 },
  tradingvolumeshares: { field: 'tradingVolume', scale: 1 },
  tradingvolumemilshares: { field: 'tradingVolume', scale: MILLION },
  dailyaverageoftradingvolumeshares: { field: 'dailyAvgVolume', scale: 1 },
  totaltradingvaluekhr: { field: 'tradingValueKhr', scale: 1 },
  tradingvaluemilkhr: { field: 'tradingValueKhr', scale: MILLION },
  dailyaveragekhr: { field: 'dailyAvgValueKhr', scale: 1 },
  dailyaverageoftradingvaluemilkhr: { field: 'dailyAvgValueKhr', scale: MILLION },
  closingindex: { field: 'indexClose', scale: 1 },
  csxindexclosingindex: { field: 'indexClose', scale: 1 },
  numberofinvestors: { field: 'investorCount', scale: 1 },
  numberofinvestor: { field: 'investorCount', scale: 1 },
};

/** Measures Prisma stores as integers rather than decimals. */
const INTEGER_FIELDS = new Set<MeasureField>(['tradingDays', 'listedCompanies', 'investorCount']);

function coerceMeasures(measures: Partial<Record<MeasureField, number>>) {
  return Object.fromEntries(
    Object.entries(measures).map(([field, value]) => [
      field,
      INTEGER_FIELDS.has(field as MeasureField) ? Math.round(value) : value,
    ]),
  );
}

function boardFromTitle(title: string): BoardScope {
  if (/main\s*board/i.test(title)) return 'main';
  if (/growth\s*board/i.test(title)) return 'growth';
  return 'all';
}

function soleYearInTitle(title: string): number | null {
  const years = [...title.matchAll(/(20\d{2})/g)].map((match) => Number(match[1]));
  return years.length === 1 ? years[0]! : null;
}

/**
 * Reads a "Statistic Report Equity Securities, YYYY" file.
 *
 * These carry a quarter label plus explicit start and end dates. The dates are
 * not trustworthy: the 2023 edition dates its Q3 and Q4 rows to 2022, which
 * would silently overwrite the genuine 2022 quarters. The figures themselves
 * are right for the year on the dataset — the Q3 market capitalisation in the
 * 2023 file matches SERC's separately published Q3 2023 total — so the period
 * is reconstructed from the dataset's year and the quarter label, and the
 * discrepancy is reported rather than quietly absorbed.
 */
function parseStatisticReport(csv: string, datasetYear: number | null, warnings: string[]) {
  return parseCsvRecords(csv).flatMap((record) => {
    const normalised = new Map(
      Object.entries(record).map(([key, value]) => [normaliseKey(key), value]),
    );
    const quarterLabel = normalised.get('quarter');
    const quarter = Number((quarterLabel ?? '').replace(/[^0-9]/g, ''));
    if (!(quarter >= 1 && quarter <= 4)) return [];

    const statedStart = normalised.get('startdate');
    const statedYear = statedStart ? Number(statedStart.slice(0, 4)) : null;
    const year = datasetYear ?? statedYear;
    if (year === null) return [];

    if (statedYear !== null && statedYear !== year) {
      warnings.push(
        `Q${quarter} in the ${year} equity statistics report is dated ${statedStart} upstream; ` +
          `filed under Q${quarter} ${year} to match the rest of the dataset.`,
      );
    }

    const measures: Partial<Record<MeasureField, number>> = {};
    for (const [key, value] of normalised) {
      const metric = METRICS[key];
      if (!metric) continue;
      const parsed = parseGrouped(value);
      if (parsed === null) continue;
      measures[metric.field] = parsed * metric.scale;
    }
    if (Object.keys(measures).length === 0) return [];

    const bounds = quarterBounds(year, quarter);
    return [
      {
        periodStart: bounds.start,
        periodEnd: bounds.end,
        label: `Q${quarter} ${year}`,
        measures,
      },
    ];
  });
}

/**
 * Imports every published quarterly equity-market statistic.
 *
 * Datasets are discovered by title rather than by hard-coded id, so next
 * quarter's publication is picked up without a code change. Where two exports
 * describe the same quarter with different columns, each write only carries the
 * measures its own file supplied, so a later import fills gaps but never blanks
 * a figure an earlier one provided.
 */
export async function ingestMarketStats(): Promise<IngestResult> {
  const datasets = await discoverDatasets([
    'Statistic Report Equity Securities',
    'Overview of Equity Market',
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

    const board = boardFromTitle(dataset.name);
    const titleYear = soleYearInTitle(dataset.name);

    let periods: { periodStart: string; periodEnd: string; label: string; measures: Partial<Record<MeasureField, number>> }[];
    try {
      const csv = await fetchDatasetFile(dataset.id);
      read += 1;

      periods = /statistic report equity securities/i.test(dataset.name)
        ? parseStatisticReport(csv, titleYear, warnings)
        : parseQuarterTable(csv, METRICS, titleYear).map((record) => {
            const bounds = quarterBounds(record.year, record.quarter);
            return {
              periodStart: bounds.start,
              periodEnd: bounds.end,
              label: `Q${record.quarter} ${record.year}`,
              measures: record.measures,
            };
          });
    } catch (error) {
      warnings.push(`${dataset.name}: ${error instanceof Error ? error.message : String(error)}`);
      skipped += 1;
      continue;
    }

    if (periods.length === 0) {
      warnings.push(`No quarterly figures could be read from "${dataset.name}".`);
      skipped += 1;
      continue;
    }

    for (const period of periods) {
      const periodStart = toDateColumn(period.periodStart)!;
      const shared = {
        periodEnd: toDateColumn(period.periodEnd)!,
        label: period.label,
        ...coerceMeasures(period.measures),
        sourceCode: SOURCES.MEF_EQUITY_STATS,
        sourceDatasetId: dataset.id,
        sourceUrl: datasetPageUrl(dataset.id),
        importedAt: new Date(),
      };

      await prisma.marketPeriodStat.upsert({
        where: { board_periodType_periodStart: { board, periodType: 'quarter', periodStart } },
        create: { board, periodType: 'quarter', periodStart, ...shared },
        update: shared,
      });
      written += 1;
    }
  }

  log.info(`imported ${written} quarterly market rows from ${read} datasets`);
  return { rowsRead: read, rowsWritten: written, rowsSkipped: skipped, warnings };
}

export const marketStatsAdapter: Adapter = {
  key: 'market-stats',
  sourceCode: SOURCES.MEF_EQUITY_STATS,
  title: 'Quarterly equity market statistics',
  run: ingestMarketStats,
};
