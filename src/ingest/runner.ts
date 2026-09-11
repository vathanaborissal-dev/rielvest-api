import { logger } from '../core/logger.ts';
import { prisma } from '../core/prisma.ts';
import { companiesAdapter } from './adapters/companies.adapter.ts';
import { companyStatsAdapter } from './adapters/companyStats.adapter.ts';
import { csxDisclosuresAdapter } from './adapters/csxDisclosures.adapter.ts';
import { csxIndexAdapter } from './adapters/csxIndex.adapter.ts';
import { csxIndexHistoryAdapter } from './adapters/csxIndexHistory.adapter.ts';
import { csxTradeSummaryAdapter } from './adapters/csxTradeSummary.adapter.ts';
import {
  csxChartHistoryAdapter,
  csxChartRecentAdapter,
} from './adapters/csxChartHistory.adapter.ts';
import { csxSummaryAdapter } from './adapters/csxSummary.adapter.ts';
import { exchangeRatesAdapter } from './adapters/exchangeRates.adapter.ts';
import { marketStatsAdapter } from './adapters/marketStats.adapter.ts';
import { narrativesAdapter } from './adapters/narratives.adapter.ts';
import { SOURCE_DEFINITIONS } from './sources.ts';
import type { Adapter } from './types.ts';
import type { RunTrigger } from '../generated/prisma/client.ts';

const log = logger('ingest');

/**
 * Order matters: the company register must exist before quotes can attach to
 * it, and the daily feeds are cheapest so they run before the bulk imports.
 */
export const ADAPTERS: Adapter[] = [
  companiesAdapter,
  // The exchange's own summary is the authority on the current session; the
  // chart feed backfills history and the open-data mirror cross-checks both.
  csxChartRecentAdapter,
  csxTradeSummaryAdapter,
  csxChartHistoryAdapter,
  csxSummaryAdapter,
  csxIndexAdapter,
  exchangeRatesAdapter,
  csxIndexHistoryAdapter,
  csxDisclosuresAdapter,
  marketStatsAdapter,
  companyStatsAdapter,
  // Last: it reads the analysis, which depends on everything above it.
  narrativesAdapter,
];

/** The feeds worth re-checking through the day; the rest publish quarterly. */
export const DAILY_ADAPTER_KEYS = [
  // The chart feed carries today's session as soon as the bell rings; the
  // official summary lands hours later and supersedes it for that session.
  'csx-chart-recent',
  'csx-trade-summary',
  'csx-summary',
  'csx-index',
  'csx-index-history',
  'exchange-rates',
  'csx-disclosures',
  'narratives',
] as const;

export async function ensureSourcesRegistered(): Promise<void> {
  for (const source of SOURCE_DEFINITIONS) {
    const data = {
      name: source.name,
      publisher: source.publisher,
      homepageUrl: source.homepageUrl,
      endpointUrl: source.endpointUrl ?? null,
      kind: source.kind,
      cadence: source.cadence,
      license: source.license ?? null,
      description: source.description,
    };
    await prisma.dataSource.upsert({
      where: { code: source.code },
      create: { code: source.code, ...data },
      update: data,
    });
  }
}

export interface RunOutcome {
  key: string;
  title: string;
  status: 'success' | 'partial' | 'failed';
  rowsRead: number;
  rowsWritten: number;
  rowsSkipped: number;
  warnings: string[];
  error?: string;
  durationMs: number;
}

/** Runs one adapter and records the attempt, whether or not it succeeds. */
export async function runAdapter(adapter: Adapter, trigger: RunTrigger = 'manual'): Promise<RunOutcome> {
  const startedAt = Date.now();
  const run = await prisma.ingestionRun.create({
    data: { sourceCode: adapter.sourceCode, adapterKey: adapter.key, trigger, status: 'running' },
    select: { id: true },
  });

  try {
    const result = await adapter.run();
    const warnings = result.warnings ?? [];
    const status = warnings.length > 0 || result.rowsSkipped > 0 ? 'partial' : 'success';

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        rowsRead: result.rowsRead,
        rowsWritten: result.rowsWritten,
        rowsSkipped: result.rowsSkipped,
        warnings,
        detail: (result.detail ?? {}) as object,
      },
    });

    return {
      key: adapter.key,
      title: adapter.title,
      status,
      rowsRead: result.rowsRead,
      rowsWritten: result.rowsWritten,
      rowsSkipped: result.rowsSkipped,
      warnings,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`${adapter.key} failed`, message);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), error: message },
    });
    return {
      key: adapter.key,
      title: adapter.title,
      status: 'failed',
      rowsRead: 0,
      rowsWritten: 0,
      rowsSkipped: 0,
      warnings: [],
      error: message,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Runs a set of adapters in order; one failure does not stop the rest. */
export async function runAdapters(
  keys: readonly string[],
  trigger: RunTrigger = 'manual',
): Promise<RunOutcome[]> {
  await ensureSourcesRegistered();
  const outcomes: RunOutcome[] = [];

  for (const key of keys) {
    const adapter = ADAPTERS.find((candidate) => candidate.key === key);
    if (!adapter) {
      outcomes.push({
        key,
        title: key,
        status: 'failed',
        rowsRead: 0,
        rowsWritten: 0,
        rowsSkipped: 0,
        warnings: [],
        error: `Unknown ingestion adapter "${key}"`,
        durationMs: 0,
      });
      continue;
    }
    outcomes.push(await runAdapter(adapter, trigger));
  }

  return outcomes;
}

export const runAll = (trigger: RunTrigger = 'manual') =>
  runAdapters(
    ADAPTERS.map((adapter) => adapter.key),
    trigger,
  );

export const runDaily = (trigger: RunTrigger = 'schedule') => runAdapters(DAILY_ADAPTER_KEYS, trigger);
