import { toDateColumn } from '../../core/decimal.ts';
import { logger } from '../../core/logger.ts';
import { prisma } from '../../core/prisma.ts';
import {
  announcementUrl,
  fetchAnnouncementDetail,
  fetchAnnouncements,
  type CsxAnnouncement,
} from '../csxWebClient.ts';
import {
  classifyDisclosure,
  isDividendProposal,
  parseDisclosureDate,
  parseDividendDisclosure,
  toPlainText,
} from '../parsers/disclosure.ts';
import { SOURCES } from '../sources.ts';
import type { Adapter, IngestResult } from '../types.ts';

const log = logger('ingest:csx-disclosures');

/**
 * Imports every disclosure CSX has published, and reads the dividend
 * declarations out of them.
 *
 * Two things come from one archive:
 *
 *  - **Events.** Each disclosure becomes a market event, which is what the
 *    insights feed and the company timeline are built on. Bond issuers file on
 *    the same feed under tickers like "ABC32A"; those are kept, with the raw
 *    ticker recorded, but they attach to no listed equity.
 *
 *  - **Dividends.** Declarations are filed in a structured form, so the amount
 *    per share, record date and payment date can be read directly. Only the
 *    dividend disclosures have their bodies fetched — the archive runs to
 *    thousands of filings and there is no reason to pull them all.
 */
export async function ingestCsxDisclosures(): Promise<IngestResult> {
  const announcements = await fetchAnnouncements();
  const warnings: string[] = [];

  const companies = await prisma.company.findMany({ select: { id: true, symbol: true } });
  const companyBySymbol = new Map(companies.map((company) => [company.symbol, company.id]));

  let eventsWritten = 0;
  let dividendsWritten = 0;
  let skipped = 0;

  for (const announcement of announcements) {
    const eventDate = parseDisclosureDate(announcement.date);
    if (!eventDate) {
      skipped += 1;
      continue;
    }

    const rawSymbol = announcement.company?.trim() || null;
    const companyId = rawSymbol ? (companyBySymbol.get(rawSymbol) ?? null) : null;
    const eventType = classifyDisclosure(announcement.title);

    await prisma.marketEvent.upsert({
      where: {
        sourceCode_sourceRef: {
          sourceCode: SOURCES.CSX_DISCLOSURES,
          sourceRef: String(announcement.id),
        },
      },
      create: {
        companyId,
        rawSymbol,
        eventDate: toDateColumn(eventDate)!,
        eventType,
        title: announcement.title.trim(),
        url: announcementUrl(announcement.id),
        sourceCode: SOURCES.CSX_DISCLOSURES,
        sourceRef: String(announcement.id),
      },
      update: {
        companyId,
        rawSymbol,
        eventDate: toDateColumn(eventDate)!,
        eventType,
        title: announcement.title.trim(),
        url: announcementUrl(announcement.id),
      },
    });
    eventsWritten += 1;

    // A proposal still belongs in the events feed — it is genuine news — but
    // it must not be recorded as a payout alongside the decision that follows.
    if (eventType === 'dividend' && companyId && !isDividendProposal(announcement.title)) {
      const written = await importDividend(announcement, companyId, warnings);
      if (written) dividendsWritten += 1;
    }
  }

  log.info(`recorded ${eventsWritten} disclosures and ${dividendsWritten} dividend declarations`);
  return {
    rowsRead: announcements.length,
    rowsWritten: eventsWritten + dividendsWritten,
    rowsSkipped: skipped,
    warnings,
    detail: { events: eventsWritten, dividends: dividendsWritten },
  };
}

/** Reads one dividend declaration, or records why it could not be read. */
async function importDividend(
  announcement: CsxAnnouncement,
  companyId: string,
  warnings: string[],
): Promise<boolean> {
  const sourceRef = String(announcement.id);

  // Already read on an earlier run; the archive is append-only.
  const existing = await prisma.dividend.findUnique({
    where: { sourceCode_sourceRef: { sourceCode: SOURCES.CSX_DISCLOSURES, sourceRef } },
    select: { id: true },
  });
  if (existing) return false;

  let detail;
  try {
    detail = await fetchAnnouncementDetail(announcement.id);
  } catch (error) {
    warnings.push(
      `Could not read disclosure ${announcement.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }

  const parsed = parseDividendDisclosure(detail?.content);
  if (!parsed) {
    // Many "dividend" disclosures are record-date corrections, board proposals
    // or decisions not to distribute. Those are real events but not payouts,
    // and inventing an amount for them would corrupt every yield built on top.
    return false;
  }

  const announcementDate = parseDisclosureDate(announcement.date);
  // The fiscal year a dividend belongs to is the year it was resolved on, or
  // failing that the year it was announced — not the year it was paid, which
  // can fall into the following calendar year.
  const fiscalYear = Number(
    (parsed.resolutionDate ?? announcementDate ?? parsed.paymentDate ?? '').slice(0, 4),
  );

  await prisma.dividend.create({
    data: {
      companyId,
      fiscalYear: Number.isFinite(fiscalYear) && fiscalYear > 2010 ? fiscalYear : null,
      dividendType: parsed.dividendType,
      amountPerShareKhr: parsed.amountPerShareKhr,
      totalAmountKhr: parsed.totalAmountKhr,
      payoutRatioPercent: parsed.payoutRatioPercent,
      frequency: parsed.frequency,
      recordDate: toDateColumn(parsed.recordDate),
      paymentDate: toDateColumn(parsed.paymentDate),
      announcementDate: toDateColumn(announcementDate),
      sourceCode: SOURCES.CSX_DISCLOSURES,
      sourceRef,
      sourceUrl: announcementUrl(announcement.id),
      note: toPlainText(detail?.content).slice(0, 500) || null,
    },
  });
  return true;
}

export const csxDisclosuresAdapter: Adapter = {
  key: 'csx-disclosures',
  sourceCode: SOURCES.CSX_DISCLOSURES,
  title: 'CSX company disclosures and dividends',
  run: ingestCsxDisclosures,
};
