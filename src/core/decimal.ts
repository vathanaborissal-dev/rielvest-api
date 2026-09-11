import type { Prisma } from '../generated/prisma/client.ts';

/**
 * Prisma hands back `Decimal` for numeric columns and `bigint` for int8, both of
 * which are correct for storage but awkward across a JSON boundary.
 *
 * Every RielVest figure is a Cambodian riel amount, a share count or a ratio.
 * The largest of those is market capitalisation at roughly 1.2e13 riel, which
 * sits comfortably inside the 2^53 range a double represents exactly — so
 * converting at the repository boundary is lossless in practice, and keeps the
 * service and analysis layers working in plain numbers.
 */
export type DecimalLike = Prisma.Decimal | number | bigint | string | null | undefined;

export function toNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  const parsed = typeof value === 'string' ? Number(value) : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export function toNumberOr(value: DecimalLike, fallback: number): number {
  return toNumber(value) ?? fallback;
}

/** Formats a Prisma `@db.Date` column back to a plain YYYY-MM-DD string. */
export function toDateString(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Builds a UTC midnight Date for a YYYY-MM-DD string, as `@db.Date` expects. */
export function toDateColumn(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return new Date(`${value}T00:00:00.000Z`);
}
