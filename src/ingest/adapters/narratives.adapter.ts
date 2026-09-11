import { isNarrativeEnabled, narrate } from '../../ai/narrator.ts';
import { toDateColumn } from '../../core/decimal.ts';
import { logger } from '../../core/logger.ts';
import { prisma } from '../../core/prisma.ts';
import * as companiesService from '../../modules/companies/companies.service.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:narratives');

const LANGUAGES = ['en', 'km'] as const;

/**
 * Writes the plain-language summaries once per session, per language.
 *
 * Generating at ingestion rather than on request means a page never waits on a
 * model, the free API tier is spent on a fixed daily budget instead of scaling
 * with visitors, and the wording is stable for everyone looking at the same
 * session.
 *
 * Existing rows for the session are left alone: the analysis has not changed,
 * so regenerating would spend quota to produce the same sentences.
 */
export async function ingestNarratives(): Promise<IngestResult> {
  if (!isNarrativeEnabled()) {
    return {
      rowsRead: 0,
      rowsWritten: 0,
      rowsSkipped: 0,
      warnings: [
        'No narrative model is configured (GEMINI_API_KEY is unset), so pages use the ' +
          'analysis engine’s own sentences. This is a supported configuration, not a failure.',
      ],
    };
  }

  const companies = await prisma.company.findMany({
    where: { status: 'listed' },
    select: { id: true, symbol: true },
    orderBy: { symbol: 'asc' },
  });

  const warnings: string[] = [];
  let read = 0;
  let written = 0;
  let skipped = 0;

  for (const company of companies) {
    let analysis;
    let review;
    try {
      analysis = await companiesService.analyse(company.symbol);
      review = await companiesService.getDecisionReview(company.symbol);
    } catch (error) {
      warnings.push(`${company.symbol}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (!analysis.asOf) {
      skipped += 1;
      continue;
    }
    const tradeDate = toDateColumn(analysis.asOf)!;

    for (const language of LANGUAGES) {
      read += 1;

      const existing = await prisma.aiNarrative.findUnique({
        where: {
          companyId_tradeDate_language: { companyId: company.id, tradeDate, language },
        },
        select: { id: true, source: true },
      });
      // Only re-attempt a session whose stored text came from the fallback —
      // a transient model failure is worth one more try, a success is not.
      if (existing && existing.source === 'model') {
        skipped += 1;
        continue;
      }

      const result = await narrate(analysis, analysis.narrative, language, review);
      const data = {
        lines: result.lines,
        source: result.source,
        model: result.model ?? null,
        fallbackReason: result.fallbackReason ?? null,
        generatedAt: new Date(),
      };

      await prisma.aiNarrative.upsert({
        where: {
          companyId_tradeDate_language: { companyId: company.id, tradeDate, language },
        },
        create: { companyId: company.id, tradeDate, language, ...data },
        update: data,
      });

      if (result.source === 'model') written += 1;
      else {
        skipped += 1;
        if (result.fallbackReason) {
          warnings.push(`${company.symbol} (${language}): ${result.fallbackReason}`);
        }
      }
    }
  }

  log.info(`generated ${written} narratives (${skipped} fell back or were current)`);
  return { rowsRead: read, rowsWritten: written, rowsSkipped: skipped, warnings };
}

export const narrativesAdapter: Adapter = {
  key: 'narratives',
  sourceCode: SOURCES.RIELVEST_REFERENCE,
  title: 'Plain-language company summaries',
  run: ingestNarratives,
};
