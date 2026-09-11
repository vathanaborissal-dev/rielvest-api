/**
 * Standard technical calculations over daily bars.
 *
 * These are textbook definitions — Wilder's RSI and ATR, simple moving
 * averages, classic floor pivots — implemented here rather than pulled from a
 * library so that every number RielVest shows can be traced to the arithmetic
 * that produced it. Each function returns `null` rather than a partial answer
 * when there are not enough sessions to compute it honestly.
 */

export interface Bar {
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  value: number | null;
}

/** A bar with a usable high/low range, which the range-based measures need. */
interface RangeBar extends Bar {
  high: number;
  low: number;
}

const hasRange = (bar: Bar): bar is RangeBar => bar.high !== null && bar.low !== null;

export function sma(bars: Bar[], periods: number): number | null {
  if (bars.length < periods) return null;
  const window = bars.slice(-periods);
  return window.reduce((total, bar) => total + bar.close, 0) / periods;
}

/**
 * Wilder's Relative Strength Index.
 *
 * Reads 0-100: conventionally above 70 is called overbought and below 30
 * oversold. It measures how one-sided recent moves have been — nothing more.
 */
export function rsi(bars: Bar[], periods = 14): number | null {
  if (bars.length < periods + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= periods; i += 1) {
    const change = bars[i]!.close - bars[i - 1]!.close;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let averageGain = gains / periods;
  let averageLoss = losses / periods;

  // Wilder smoothing across the remaining sessions.
  for (let i = periods + 1; i < bars.length; i += 1) {
    const change = bars[i]!.close - bars[i - 1]!.close;
    averageGain = (averageGain * (periods - 1) + Math.max(change, 0)) / periods;
    averageLoss = (averageLoss * (periods - 1) + Math.max(-change, 0)) / periods;
  }

  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

/**
 * Average True Range — the typical distance a price travels in a session,
 * in riel. Useful as a reality check: a target closer than one ATR is a normal
 * day's move, while a stop tighter than one ATR is likely to be hit by noise.
 */
export function atr(bars: Bar[], periods = 14): number | null {
  const usable = bars.filter(hasRange);
  if (usable.length < periods + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < usable.length; i += 1) {
    const bar = usable[i]!;
    const previousClose = usable[i - 1]!.close;
    trueRanges.push(
      Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - previousClose),
        Math.abs(bar.low - previousClose),
      ),
    );
  }

  let average = trueRanges.slice(0, periods).reduce((total, value) => total + value, 0) / periods;
  for (let i = periods; i < trueRanges.length; i += 1) {
    average = (average * (periods - 1) + trueRanges[i]!) / periods;
  }
  return average;
}

export interface PivotLevels {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
  basedOn: { tradeDate: string; high: number; low: number; close: number };
}

/**
 * Classic floor-trader pivot points for the next session.
 *
 * Computed entirely from the previous session's high, low and close, which is
 * exactly why they are worth showing: they are unambiguous, every trader
 * computes the same numbers, and they change the moment a new session closes.
 */
export function pivotLevels(bars: Bar[]): PivotLevels | null {
  const last = [...bars].reverse().find(hasRange);
  if (!last) return null;

  const { high, low, close } = last;
  const pivot = (high + low + close) / 3;
  const range = high - low;

  return {
    pivot,
    r1: 2 * pivot - low,
    s1: 2 * pivot - high,
    r2: pivot + range,
    s2: pivot - range,
    r3: high + 2 * (pivot - low),
    s3: low - 2 * (high - pivot),
    basedOn: { tradeDate: last.tradeDate, high, low, close },
  };
}

export interface RangeExtremes {
  high: number;
  highDate: string;
  low: number;
  lowDate: string;
  /** Where the latest close sits in the range, 0% at the low and 100% at the high. */
  positionPercent: number | null;
  sessions: number;
}

export function rangeExtremes(bars: Bar[], sessions = 250): RangeExtremes | null {
  const window = bars.slice(-sessions).filter(hasRange);
  if (window.length < 2) return null;

  let highest = window[0]!;
  let lowest = window[0]!;
  for (const bar of window) {
    if (bar.high > highest.high) highest = bar;
    if (bar.low < lowest.low) lowest = bar;
  }

  const close = window.at(-1)!.close;
  const span = highest.high - lowest.low;

  return {
    high: highest.high,
    highDate: highest.tradeDate,
    low: lowest.low,
    lowDate: lowest.tradeDate,
    positionPercent: span > 0 ? ((close - lowest.low) / span) * 100 : null,
    sessions: window.length,
  };
}

export interface SwingLevel {
  price: number;
  tradeDate: string;
  /** How many times price has turned within a small band of this level. */
  touches: number;
}

/**
 * Prices where the stock actually turned.
 *
 * A swing high is a session whose high exceeds the `lookaround` sessions on
 * either side of it; a swing low is the mirror image. Unlike a moving average,
 * these are levels the market itself has already reacted to, which is what
 * makes them worth watching. Nearby swings are merged so one pivot area is not
 * reported as five separate levels.
 */
export function swingLevels(
  bars: Bar[],
  options: { lookaround?: number; sessions?: number; mergeWithinPercent?: number } = {},
): { resistance: SwingLevel[]; support: SwingLevel[] } {
  const lookaround = options.lookaround ?? 3;
  const window = bars.slice(-(options.sessions ?? 250)).filter(hasRange);
  const mergeWithin = (options.mergeWithinPercent ?? 1.5) / 100;

  const highs: SwingLevel[] = [];
  const lows: SwingLevel[] = [];

  for (let i = lookaround; i < window.length - lookaround; i += 1) {
    const bar = window[i]!;
    const neighbours = window.slice(i - lookaround, i + lookaround + 1);
    if (neighbours.every((other) => other === bar || other.high <= bar.high)) {
      highs.push({ price: bar.high, tradeDate: bar.tradeDate, touches: 1 });
    }
    if (neighbours.every((other) => other === bar || other.low >= bar.low)) {
      lows.push({ price: bar.low, tradeDate: bar.tradeDate, touches: 1 });
    }
  }

  const close = window.at(-1)?.close ?? 0;
  return {
    // Only levels the price has yet to clear are resistance; the rest are history.
    resistance: merge(highs.filter((level) => level.price > close), mergeWithin)
      .sort((a, b) => a.price - b.price)
      .slice(0, 3),
    support: merge(lows.filter((level) => level.price < close), mergeWithin)
      .sort((a, b) => b.price - a.price)
      .slice(0, 3),
  };
}

/** Collapses levels that sit within `tolerance` of each other into one. */
function merge(levels: SwingLevel[], tolerance: number): SwingLevel[] {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const merged: SwingLevel[] = [];

  for (const level of sorted) {
    const previous = merged.at(-1);
    if (previous && Math.abs(level.price - previous.price) / previous.price <= tolerance) {
      // Keep the most recent date; a level tested lately matters more.
      previous.touches += 1;
      if (level.tradeDate > previous.tradeDate) previous.tradeDate = level.tradeDate;
      previous.price = (previous.price * (previous.touches - 1) + level.price) / previous.touches;
      continue;
    }
    merged.push({ ...level });
  }

  return merged;
}

/** Latest session's volume against its recent average. 1.0 means typical. */
export function volumeRatio(bars: Bar[], periods = 20): number | null {
  const volumes = bars
    .slice(-(periods + 1), -1)
    .map((bar) => bar.volume)
    .filter((volume): volume is number => volume !== null && volume > 0);
  const latest = bars.at(-1)?.volume ?? null;
  if (latest === null || volumes.length < Math.min(5, periods)) return null;
  const average = volumes.reduce((total, volume) => total + volume, 0) / volumes.length;
  return average > 0 ? latest / average : null;
}

/** Where the close sat within its own session range, 0% at the low. */
export function closePositionInDay(bar: Bar | undefined): number | null {
  if (!bar || !hasRange(bar)) return null;
  const span = bar.high - bar.low;
  return span > 0 ? ((bar.close - bar.low) / span) * 100 : 50;
}
