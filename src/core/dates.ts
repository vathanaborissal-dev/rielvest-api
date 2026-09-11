/** Cambodia has no daylight saving; ICT is a fixed UTC+7. */
export const CAMBODIA_UTC_OFFSET_MINUTES = 7 * 60;

/** Today's calendar date in Cambodia, as YYYY-MM-DD. */
export function cambodiaToday(now: Date = new Date()): string {
  return toCambodiaDate(now);
}

export function toCambodiaDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + CAMBODIA_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Parses the "2026/09/10" shape used by the CSX index feed. */
export function parseSlashDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export function quarterOf(month: number): 1 | 2 | 3 | 4 {
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function quarterBounds(year: number, quarter: number): { start: string; end: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return {
    start: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

export function monthBounds(year: number, month: number): { start: string; end: string } {
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}
