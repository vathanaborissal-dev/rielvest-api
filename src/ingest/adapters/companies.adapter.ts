import { prisma } from '../../core/prisma.ts';
import { toDateColumn } from '../../core/decimal.ts';
import { logger } from '../../core/logger.ts';
import { COMPANY_SEEDS, COMPANY_SEED_NOTE, COMPANY_SEED_SOURCE_URL } from '../seed/companies.seed.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:companies');

/**
 * Upserts the curated company register.
 *
 * Descriptive fields are always refreshed from the seed, which is their
 * authority. `isin` is deliberately untouched — the CSX feed supplies the real
 * instrument code — and no share count or financial figure is ever written here.
 */
export async function syncCompanies(): Promise<IngestResult> {
  let written = 0;

  for (const seed of COMPANY_SEEDS) {
    const fields = {
      name: seed.name,
      legalName: seed.legalName,
      sector: seed.sector,
      industry: seed.industry,
      board: seed.board,
      listingDate: toDateColumn(seed.listingDate),
      website: seed.website ?? null,
      description: seed.description,
      sourceCode: SOURCES.RIELVEST_REFERENCE,
      sourceUrl: COMPANY_SEED_SOURCE_URL,
      sourceNote: COMPANY_SEED_NOTE,
    };

    await prisma.company.upsert({
      where: { symbol: seed.symbol },
      create: { symbol: seed.symbol, ...fields },
      update: fields,
    });
    written += 1;
  }

  log.info(`synced ${written} companies`);
  return { rowsRead: COMPANY_SEEDS.length, rowsWritten: written, rowsSkipped: 0 };
}

export const companiesAdapter: Adapter = {
  key: 'companies',
  sourceCode: SOURCES.RIELVEST_REFERENCE,
  title: 'Listed company register',
  run: syncCompanies,
};
