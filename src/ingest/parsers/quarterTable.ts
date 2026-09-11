import { parseGrouped } from '../../core/num.ts';
import { parseCsv } from '../csv.ts';

/**
 * Reads quarterly figures out of the CSX and SERC exports.
 *
 * The publishers use three different layouts for the same information, and the
 * shape varies between companies and between years, so the reader detects it
 * rather than assuming:
 *
 *   1. Wide — metrics down the rows, quarters across the header:
 *        Overview,Q1,Q2,Q3,Q4
 *        Market Cap. (Mil. KHR),4184355,3292039,…
 *
 *   2. Tall — one row per quarter, metrics across the header:
 *        quarter,market_cap_mil_khr,trading_volume_shares,…
 *        Q1,631425.0,100834.0,…
 *
 *   3. Tall with an explicit year column, covering several years in one file:
 *        year,quarter_of_year,market_cap_mil_khr,…
 *        2023,Q1,7480353,…
 *
 * Some tall files label the quarter column "Overview" instead of "quarter", so
 * when no header names it the first column's values are sniffed instead.
 *
 * Header spelling drifts too — asterisks, trailing underscores, spacing and
 * case all vary — so every label is compared in normalised form.
 */

/** Reduces a header label to comparable form: "Market Cap. (Mil. KHR)*" -> "marketcapmilkhr". */
export const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface MetricSpec<F extends string> {
  field: F;
  /** Multiplier converting the published unit to a base unit (riel, shares). */
  scale: number;
}

export interface QuarterRecord<F extends string> {
  year: number;
  quarter: number;
  measures: Partial<Record<F, number>>;
}

function readQuarterLabel(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^q?([1-4])$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

export function parseQuarterTable<F extends string>(
  csv: string,
  metrics: Record<string, MetricSpec<F>>,
  /** Used when the file itself does not carry a year column. */
  fallbackYear: number | null,
): QuarterRecord<F>[] {
  const rows = parseCsv(csv);
  const header = rows[0];
  if (!header) return [];

  const quarterColumns = new Map<number, number>();
  header.forEach((cell, index) => {
    const quarter = readQuarterLabel(cell);
    if (quarter !== null) quarterColumns.set(index, quarter);
  });

  return quarterColumns.size > 0
    ? parseWide(rows, quarterColumns, metrics, fallbackYear)
    : parseTall(rows, header, metrics, fallbackYear);
}

/** Layout 1: quarters across the header. */
function parseWide<F extends string>(
  rows: string[][],
  quarterColumns: Map<number, number>,
  metrics: Record<string, MetricSpec<F>>,
  fallbackYear: number | null,
): QuarterRecord<F>[] {
  if (fallbackYear === null) return [];

  const byQuarter = new Map<number, Partial<Record<F, number>>>();
  for (const row of rows.slice(1)) {
    const metric = metrics[normaliseKey(row[0] ?? '')];
    if (!metric) continue;
    for (const [columnIndex, quarter] of quarterColumns) {
      const value = parseGrouped(row[columnIndex]);
      if (value === null) continue;
      const bucket: Partial<Record<F, number>> = byQuarter.get(quarter) ?? {};
      bucket[metric.field] = value * metric.scale;
      byQuarter.set(quarter, bucket);
    }
  }

  // Quarters that have not been reported yet arrive as an empty column.
  return [...byQuarter.entries()]
    .filter(([, measures]) => Object.keys(measures).length > 0)
    .map(([quarter, measures]) => ({ year: fallbackYear, quarter, measures }));
}

/** Layouts 2 and 3: one row per quarter. */
function parseTall<F extends string>(
  rows: string[][],
  header: string[],
  metrics: Record<string, MetricSpec<F>>,
  fallbackYear: number | null,
): QuarterRecord<F>[] {
  const normalisedHeader = header.map(normaliseKey);
  let quarterIndex = normalisedHeader.findIndex(
    (key) => key === 'quarter' || key === 'quarterofyear',
  );

  // Fall back to sniffing the first column: several exports head it "Overview"
  // yet fill it with Q1..Q4.
  if (quarterIndex === -1) {
    const firstColumnIsQuarters =
      rows.length > 1 && rows.slice(1).every((row) => readQuarterLabel(row[0]) !== null);
    if (!firstColumnIsQuarters) return [];
    quarterIndex = 0;
  }
  const yearIndex = normalisedHeader.findIndex((key) => key === 'year' || key === 'refyear');

  const records: QuarterRecord<F>[] = [];
  for (const row of rows.slice(1)) {
    const quarter = readQuarterLabel(row[quarterIndex]);
    if (quarter === null) continue;

    const year = yearIndex === -1 ? fallbackYear : parseGrouped(row[yearIndex]);
    if (year === null) continue;

    const measures: Partial<Record<F, number>> = {};
    normalisedHeader.forEach((key, index) => {
      const metric = metrics[key];
      if (!metric) return;
      const value = parseGrouped(row[index]);
      if (value === null) return;
      measures[metric.field] = value * metric.scale;
    });

    if (Object.keys(measures).length > 0) records.push({ year, quarter, measures });
  }

  return records;
}
