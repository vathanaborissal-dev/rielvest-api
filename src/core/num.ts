/**
 * Helpers for the string-shaped numerics that come back from Postgres.
 *
 * Money in this codebase is KHR, whose smallest meaningful unit is the riel
 * itself, so IEEE doubles are comfortably precise for every figure we handle
 * (the largest is market capitalisation, ~1.2e13 riel, well inside 2^53).
 * We still parse deliberately rather than letting the driver guess.
 */

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function numOr(value: unknown, fallback: number): number {
  return num(value) ?? fallback;
}

/** Parses figures like "9,140" or "1,997,774,480" from the CSX feed. */
export function parseGrouped(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  // CSX writes "-" where it has no value to report (e.g. P/E for a loss-maker).
  if (text === '' || text === '-' || text === 'N/A') return null;
  const parsed = Number(text.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Percentage change from `from` to `to`, or null when it is not meaningful. */
export function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return sum(values) / values.length;
}

/** Sample standard deviation; needs at least two observations. */
export function stdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
