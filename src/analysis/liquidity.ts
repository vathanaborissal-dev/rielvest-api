/** A quiet session is evidence. A missing turnover figure is not a zero. */
export function averageTurnover(bars: { value: number | null }[], periods = 20): number | null {
  const window = bars.slice(-periods);
  if (window.length < periods || window.some(({ value }) => value === null || !Number.isFinite(value) || value < 0)) {
    return null;
  }
  return window.reduce((sum, bar) => sum + bar.value!, 0) / periods;
}
