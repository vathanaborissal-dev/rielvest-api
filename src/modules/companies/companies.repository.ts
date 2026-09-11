import { prisma } from '../../core/prisma.ts';
import type { Board, Prisma } from '../../generated/prisma/client.ts';

export type CompanyRecord = Prisma.CompanyGetPayload<{
  include: { source: { select: { code: true; name: true; publisher: true; homepageUrl: true } } };
}>;

const withSource = {
  source: { select: { code: true, name: true, publisher: true, homepageUrl: true } },
} satisfies Prisma.CompanyInclude;

export function listCompanies(filter: {
  search?: string;
  sector?: string;
  board?: Board;
}): Promise<CompanyRecord[]> {
  return prisma.company.findMany({
    where: {
      ...(filter.board ? { board: filter.board } : {}),
      ...(filter.sector ? { sector: filter.sector } : {}),
      ...(filter.search
        ? {
            OR: [
              { symbol: { contains: filter.search, mode: 'insensitive' } },
              { name: { contains: filter.search, mode: 'insensitive' } },
              { legalName: { contains: filter.search, mode: 'insensitive' } },
              { sector: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: withSource,
    orderBy: { symbol: 'asc' },
  });
}

export function findBySymbol(symbol: string): Promise<CompanyRecord | null> {
  return prisma.company.findUnique({
    where: { symbol: symbol.toUpperCase() },
    include: withSource,
  });
}

export function findManyBySymbols(symbols: string[]): Promise<CompanyRecord[]> {
  return prisma.company.findMany({
    where: { symbol: { in: symbols.map((symbol) => symbol.toUpperCase()) } },
    include: withSource,
  });
}

export async function listSectors(): Promise<string[]> {
  const rows = await prisma.company.findMany({
    where: { sector: { not: null } },
    distinct: ['sector'],
    select: { sector: true },
    orderBy: { sector: 'asc' },
  });
  return rows.map((row) => row.sector!).filter(Boolean);
}

export function dividendsFor(companyId: string) {
  return prisma.dividend.findMany({
    where: { companyId },
    orderBy: [{ fiscalYear: 'asc' }, { paymentDate: 'asc' }],
  });
}

export function financialsFor(companyId: string) {
  return prisma.financialStatement.findMany({
    where: { companyId },
    orderBy: [{ fiscalYear: 'asc' }, { periodEnd: 'asc' }],
  });
}

export function eventsFor(companyId: string, limit = 20) {
  return prisma.marketEvent.findMany({
    where: { companyId },
    orderBy: { eventDate: 'desc' },
    take: limit,
  });
}
