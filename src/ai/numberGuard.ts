/**
 * The guard that makes an AI narrative acceptable in this product.
 *
 * RielVest's entire claim is that it does not invent figures. A language model
 * asked to describe financial data will, eventually, produce a number that was
 * never in its input — a transposed digit, a plausible-looking average, a
 * percentage it inferred. That failure is silent and reads exactly like a real
 * figure.
 *
 * So every number the model writes is checked against the numbers it was given.
 * Anything unaccounted for fails the whole passage, and the caller falls back
 * to the deterministic sentences the analysis engine already produces. The
 * model is allowed to improve the wording; it is never allowed to introduce a
 * quantity.
 */

/** Matches numbers as written in prose: 9,240 · 1.09 · -0.5 · 12% */
const NUMBER_PATTERN = /-?\d[\d,]*(?:\.\d+)?/g;

export interface GuardResult {
  ok: boolean;
  /** Numbers in the text that could not be traced to the source data. */
  unsupported: number[];
  checked: number;
}

/** Every number reachable in a JSON value, at any depth. */
export function collectNumbers(value: unknown, into = new Set<number>()): Set<number> {
  if (value === null || value === undefined) return into;

  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.add(value);
    return into;
  }

  if (typeof value === 'string') {
    // Dates and pre-formatted figures carry numbers the model may legitimately
    // repeat ("the 2026-09-11 session", "9,240 KHR").
    for (const match of value.match(NUMBER_PATTERN) ?? []) {
      const parsed = Number(match.replace(/,/g, ''));
      if (Number.isFinite(parsed)) into.add(parsed);
    }
    return into;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, into);
    return into;
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectNumbers(item, into);
    }
  }

  return into;
}

/**
 * Expands the allowed set with the roundings a writer would naturally use.
 *
 * A model given 1.0940919 will sensibly write "1.09%" or "1%". Those are the
 * same fact, not a new one, so each source number also permits its own value
 * rounded to 0, 1 and 2 decimal places, and to the nearest thousand for the
 * large riel figures that get written as "15,000".
 */
function allowedForms(numbers: Set<number>): Set<number> {
  const allowed = new Set<number>();
  for (const value of numbers) {
    allowed.add(value);
    allowed.add(Math.round(value));
    allowed.add(Math.round(value * 10) / 10);
    allowed.add(Math.round(value * 100) / 100);
    allowed.add(Math.abs(value));
    allowed.add(Math.round(Math.abs(value)));
    if (Math.abs(value) >= 1000) allowed.add(Math.round(value / 1000) * 1000);
    if (Math.abs(value) >= 1_000_000) allowed.add(Math.round(value / 1_000_000));
    if (Math.abs(value) >= 1_000_000_000) allowed.add(Math.round(value / 1_000_000_000));
  }
  return allowed;
}

/** True when `candidate` is one of `allowed` within a rounding tolerance. */
function isSupported(candidate: number, allowed: Set<number>): boolean {
  if (allowed.has(candidate)) return true;

  // Only absorb floating-point representation error. A percentage tolerance
  // on a share price silently allowed different, unsourced prices through.
  for (const value of allowed) {
    if (Math.abs(value - candidate) <= Number.EPSILON * Math.max(Math.abs(value), 1) * 4) return true;
  }
  return false;
}

/**
 * Checks a generated passage against the data it was generated from.
 *
 * `source` is the exact object handed to the model. Anything the model was not
 * shown cannot be verified and therefore fails.
 */
export function guardNumbers(text: string, source: unknown): GuardResult {
  const allowed = allowedForms(collectNumbers(source));
  const written = text.match(NUMBER_PATTERN) ?? [];

  const unsupported: number[] = [];
  for (const raw of written) {
    const candidate = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(candidate)) continue;
    if (!isSupported(candidate, allowed)) unsupported.push(candidate);
  }

  return { ok: unsupported.length === 0, unsupported, checked: written.length };
}
