import { pctChange, round } from '../core/num.ts';
import {
  atr,
  closePositionInDay,
  pivotLevels,
  rangeExtremes,
  rsi,
  sma,
  swingLevels,
  volumeRatio,
  type Bar,
  type PivotLevels,
} from './indicators.ts';
import type { Assessment } from './types.ts';

/**
 * "Where is this stock trading, and what prices matter today?"
 *
 * This is a reference card, not a recommendation. Every level below is
 * arithmetic on prices CSX has already published — pivots from yesterday's
 * range, averages of past closes, prices where the stock actually turned. None
 * of it forecasts anything, and the wording throughout stays descriptive.
 *
 * Because every input is the previous session, the whole card changes as soon
 * as a new session is recorded.
 */

export interface PriceLevel {
  label: string;
  price: number;
  /** Distance from the last close, in percent. Negative means below. */
  distancePercent: number;
  kind: 'support' | 'resistance' | 'pivot' | 'reference';
  /**
   * `pivot` levels are recomputed from yesterday's range and therefore always
   * sit within a fraction of a percent of the close — useful intraday markers,
   * but meaningless as "the stock is testing this level". `structural` levels
   * are prices the market has actually reacted to: prior swings, moving
   * averages and the 52-week extremes.
   */
  origin: 'pivot' | 'structural';
  /**
   * How many times price has turned within a small band of this level. A level
   * tested three times is structure; one tested once is a single data point.
   */
  touches: number;
  /** How this level was arrived at. */
  method: string;
}

export interface LevelSignal {
  label: string;
  value: number | null;
  unit: string;
  reading: string;
  assessment: Assessment;
  method: string;
}

export interface PriceLevels {
  symbol: string;
  asOf: string | null;
  close: number | null;
  /** Where the close sat inside its own session range, 0% at the low. */
  closePositionPercent: number | null;
  /** Ordered low to high, so the interface can draw them as a ladder. */
  levels: PriceLevel[];
  /** Nearest level of any kind, pivots included. */
  nearestSupport: PriceLevel | null;
  nearestResistance: PriceLevel | null;
  /** Nearest level the market has actually reacted to. This is the one to read. */
  nearestStructuralSupport: PriceLevel | null;
  nearestStructuralResistance: PriceLevel | null;
  /** Today's intraday reference triplet, from yesterday's range. */
  pivots: { s1: number; pivot: number; r1: number; basedOn: string } | null;
  signals: LevelSignal[];
  /** One or two sentences a reader can take in at a glance. */
  summary: string[];
  /** Typical single-session move in riel, for sizing targets and stops. */
  averageTrueRange: number | null;
  averageTrueRangePercent: number | null;
  sessionsAvailable: number;
  method: string;
  caution: string;
}

const CAUTION =
  'These are reference levels calculated from prices CSX has already published. They describe ' +
  'where the stock has traded, not where it will trade. RielVest does not give buy or sell advice.';

const METHOD =
  'Pivots use the classic floor-trader formula on the previous session\'s high, low and close. ' +
  'Moving averages, RSI (Wilder, 14), average true range (Wilder, 14), the 52-week range and prior ' +
  'swing highs and lows are all computed from the daily bars CSX publishes.';

function toLevel(
  label: string,
  price: number,
  close: number,
  kind: PriceLevel['kind'],
  origin: PriceLevel['origin'],
  method: string,
  touches = 1,
): PriceLevel {
  return {
    label,
    price,
    distancePercent: pctChange(close, price) ?? 0,
    kind,
    origin,
    touches,
    method,
  };
}

function pivotLevelsToList(pivots: PivotLevels, close: number): PriceLevel[] {
  const from = `Classic pivot from the ${pivots.basedOn.tradeDate} session (high ${round(pivots.basedOn.high, 0)}, low ${round(pivots.basedOn.low, 0)}, close ${round(pivots.basedOn.close, 0)}).`;
  return [
    toLevel('S2', pivots.s2, close, 'support', 'pivot', from),
    toLevel('S1', pivots.s1, close, 'support', 'pivot', from),
    toLevel('Pivot', pivots.pivot, close, 'pivot', 'pivot', from),
    toLevel('R1', pivots.r1, close, 'resistance', 'pivot', from),
    toLevel('R2', pivots.r2, close, 'resistance', 'pivot', from),
  ];
}

export function buildPriceLevels(symbol: string, bars: Bar[]): PriceLevels {
  const latest = bars.at(-1) ?? null;
  const close = latest?.close ?? null;

  if (!latest || close === null || bars.length < 2) {
    return {
      symbol,
      asOf: latest?.tradeDate ?? null,
      close,
      closePositionPercent: null,
      levels: [],
      nearestSupport: null,
      nearestResistance: null,
      nearestStructuralSupport: null,
      nearestStructuralResistance: null,
      pivots: null,
      signals: [],
      summary: [
        'Not enough recorded sessions to calculate price levels for this stock yet.',
      ],
      averageTrueRange: null,
      averageTrueRangePercent: null,
      sessionsAvailable: bars.length,
      method: METHOD,
      caution: CAUTION,
    };
  }

  const levels: PriceLevel[] = [];

  const pivots = pivotLevels(bars.slice(0, -1).length > 0 ? bars.slice(0, -1) : bars);
  if (pivots) levels.push(...pivotLevelsToList(pivots, close));

  const swings = swingLevels(bars);
  for (const level of swings.support) {
    levels.push(
      toLevel(
        'Prior low',
        level.price,
        close,
        'support',
        'structural',
        `The stock turned here on ${level.tradeDate}${level.touches > 1 ? ` and on ${level.touches - 1} other occasion${level.touches > 2 ? 's' : ''}` : ''}.`,
        level.touches,
      ),
    );
  }
  for (const level of swings.resistance) {
    levels.push(
      toLevel(
        'Prior high',
        level.price,
        close,
        'resistance',
        'structural',
        `The stock turned back here on ${level.tradeDate}${level.touches > 1 ? ` and on ${level.touches - 1} other occasion${level.touches > 2 ? 's' : ''}` : ''}.`,
        level.touches,
      ),
    );
  }

  const ma50 = sma(bars, 50);
  const ma200 = sma(bars, 200);
  if (ma50 !== null) {
    levels.push(
      toLevel('50-day average', ma50, close, ma50 < close ? 'support' : 'resistance', 'structural', 'Mean closing price of the last 50 sessions.', 3),
    );
  }
  if (ma200 !== null) {
    levels.push(
      toLevel('200-day average', ma200, close, ma200 < close ? 'support' : 'resistance', 'structural', 'Mean closing price of the last 200 sessions.', 4),
    );
  }

  const yearRange = rangeExtremes(bars, 250);
  if (yearRange) {
    levels.push(
      toLevel('52-week high', yearRange.high, close, 'resistance', 'structural', `Highest price in the last ${yearRange.sessions} sessions, set on ${yearRange.highDate}.`, 4),
      toLevel('52-week low', yearRange.low, close, 'support', 'structural', `Lowest price in the last ${yearRange.sessions} sessions, set on ${yearRange.lowDate}.`, 4),
    );
  }

  levels.sort((a, b) => a.price - b.price);

  const belowClose = levels.filter((level) => level.price < close);
  const aboveClose = levels.filter((level) => level.price > close);
  const nearestSupport = belowClose.at(-1) ?? null;
  const nearestResistance = aboveClose[0] ?? null;
  const nearestStructuralSupport =
    belowClose.filter((level) => level.origin === 'structural').at(-1) ?? null;
  const nearestStructuralResistance =
    aboveClose.find((level) => level.origin === 'structural') ?? null;

  // --- Signals --------------------------------------------------------------

  const signals: LevelSignal[] = [];
  const trueRange = atr(bars);
  const rsiValue = rsi(bars);
  const volume = volumeRatio(bars);
  const closePosition = closePositionInDay(latest);

  if (rsiValue !== null) {
    signals.push({
      label: 'RSI (14)',
      value: rsiValue,
      unit: 'index',
      reading:
        rsiValue >= 70
          ? `At ${round(rsiValue, 0)}, recent sessions have been strongly one-sided to the upside — conventionally read as overbought.`
          : rsiValue <= 30
            ? `At ${round(rsiValue, 0)}, recent sessions have been strongly one-sided to the downside — conventionally read as oversold.`
            : `At ${round(rsiValue, 0)}, recent buying and selling have been fairly balanced.`,
      assessment: rsiValue >= 70 ? 'caution' : rsiValue <= 30 ? 'caution' : 'neutral',
      method: 'Wilder’s relative strength index over 14 sessions.',
    });
  }

  if (ma50 !== null) {
    const gap = pctChange(ma50, close)!;
    signals.push({
      label: 'Versus 50-day average',
      value: gap,
      unit: 'percent',
      reading:
        gap >= 0
          ? `Trading ${round(gap, 1)}% above its 50-day average of ${round(ma50, 0).toLocaleString('en-US')} riel.`
          : `Trading ${round(Math.abs(gap), 1)}% below its 50-day average of ${round(ma50, 0).toLocaleString('en-US')} riel.`,
      assessment: gap >= 0 ? 'improving' : 'caution',
      method: 'Latest close against the mean of the last 50 closes.',
    });
  }

  if (volume !== null) {
    signals.push({
      label: 'Volume versus normal',
      value: volume,
      unit: 'x',
      reading:
        volume >= 2
          ? `Turnover was ${round(volume, 1)} times its 20-day average — an unusually busy session.`
          : volume >= 1.2
            ? `Turnover ran ${round(volume, 1)} times its 20-day average, a little above normal.`
            : volume <= 0.5
              ? `Turnover was only ${round(volume, 1)} times its 20-day average, so the move rests on thin trading.`
              : 'Turnover was close to its 20-day average.',
      assessment: volume >= 2 ? 'improving' : volume <= 0.5 ? 'caution' : 'neutral',
      method: 'Latest session volume ÷ the mean of the previous 20 sessions.',
    });
  }

  if (yearRange?.positionPercent !== null && yearRange !== null) {
    signals.push({
      label: 'Position in 52-week range',
      value: yearRange.positionPercent,
      unit: 'percent',
      reading: `Sits ${round(yearRange.positionPercent!, 0)}% of the way up a 52-week range of ${round(yearRange.low, 0).toLocaleString('en-US')} to ${round(yearRange.high, 0).toLocaleString('en-US')} riel.`,
      assessment:
        yearRange.positionPercent! >= 80
          ? 'caution'
          : yearRange.positionPercent! <= 20
            ? 'caution'
            : 'neutral',
      method: 'Latest close within the highest and lowest prices of the last 250 sessions.',
    });
  }

  // --- The quick read -------------------------------------------------------

  const summary: string[] = [];
  const dayShape =
    closePosition === null
      ? ''
      : closePosition >= 75
        ? ', closing near the top of its session range'
        : closePosition <= 25
          ? ', closing near the bottom of its session range'
          : ', closing mid-range';

  summary.push(
    `${symbol} last traded at ${round(close, 0).toLocaleString('en-US')} riel on ${latest.tradeDate}${dayShape}.`,
  );

  if (nearestStructuralSupport && nearestStructuralResistance) {
    summary.push(
      `The nearest level that has actually turned the price is ${nearestStructuralSupport.label.toLowerCase()} at ${round(nearestStructuralSupport.price, 0).toLocaleString('en-US')} riel below (${round(Math.abs(nearestStructuralSupport.distancePercent), 1)}% away), and ${nearestStructuralResistance.label.toLowerCase()} at ${round(nearestStructuralResistance.price, 0).toLocaleString('en-US')} riel above (${round(nearestStructuralResistance.distancePercent, 1)}% away).`,
    );
  } else if (nearestStructuralResistance) {
    summary.push(
      `Nothing below the current price has turned it before; the nearest level above is ${nearestStructuralResistance.label.toLowerCase()} at ${round(nearestStructuralResistance.price, 0).toLocaleString('en-US')} riel.`,
    );
  } else if (nearestStructuralSupport) {
    summary.push(
      `The stock is above every level in its recorded range; the nearest below is ${nearestStructuralSupport.label.toLowerCase()} at ${round(nearestStructuralSupport.price, 0).toLocaleString('en-US')} riel.`,
    );
  }

  if (trueRange !== null) {
    const atrPercent = (trueRange / close) * 100;
    summary.push(
      `A typical session moves about ${round(trueRange, 0).toLocaleString('en-US')} riel (${round(atrPercent, 1)}%), which is the yardstick for whether a target or a stop is within a normal day's range.`,
    );
  }

  return {
    symbol,
    asOf: latest.tradeDate,
    close,
    closePositionPercent: closePosition,
    levels,
    nearestSupport,
    nearestResistance,
    nearestStructuralSupport,
    nearestStructuralResistance,
    pivots: pivots
      ? { s1: pivots.s1, pivot: pivots.pivot, r1: pivots.r1, basedOn: pivots.basedOn.tradeDate }
      : null,
    signals,
    summary,
    averageTrueRange: trueRange,
    averageTrueRangePercent: trueRange === null ? null : (trueRange / close) * 100,
    sessionsAvailable: bars.length,
    method: METHOD,
    caution: CAUTION,
  };
}

export type { Bar } from './indicators.ts';
