import { round } from '../core/num.ts';

/**
 * The CSX rulebook, as arithmetic.
 *
 * These are not indicators or opinions — they are the exchange's own
 * constraints, and they decide whether an order can be entered at all. A limit
 * price off the tick grid is rejected; a price outside the daily band cannot be
 * matched however keen the buyer. A trader needs both before typing a number.
 *
 * Sources: CSX trading rules as published by exchange members —
 * daily price limit ±10% of the base price (KHR 10 where the base is under
 * KHR 200), the tick table below, minimum trading unit of one share, and T+2
 * settlement.
 */

/** Tick bands: a limit price must be a whole multiple of the applicable tick. */
const TICK_BANDS: { upTo: number | null; tick: number }[] = [
  { upTo: 4_000, tick: 10 },
  { upTo: 20_000, tick: 20 },
  { upTo: 40_000, tick: 50 },
  { upTo: 100_000, tick: 100 },
  { upTo: 200_000, tick: 200 },
  { upTo: 400_000, tick: 500 },
  { upTo: null, tick: 1_000 },
];

export const DAILY_PRICE_LIMIT_PERCENT = 10;
export const MINIMUM_TRADING_UNIT = 1;
export const SETTLEMENT_DAYS = 2;

/** The tick size that applies at a given price. */
export function tickSizeFor(price: number): number {
  for (const band of TICK_BANDS) {
    if (band.upTo === null || price < band.upTo) return band.tick;
  }
  return TICK_BANDS.at(-1)!.tick;
}

/**
 * Snaps a price onto the tick grid.
 *
 * `direction` matters when placing an order: rounding a buy limit *down* and a
 * sell limit *up* keeps the order at least as conservative as intended, rather
 * than quietly paying a tick more than you meant to.
 */
export function roundToTick(
  price: number,
  direction: 'nearest' | 'down' | 'up' = 'nearest',
): number {
  const tick = tickSizeFor(price);
  const steps = price / tick;
  const rounded =
    direction === 'down' ? Math.floor(steps) : direction === 'up' ? Math.ceil(steps) : Math.round(steps);
  return rounded * tick;
}

export function isValidTick(price: number): boolean {
  const tick = tickSizeFor(price);
  return Math.abs(price / tick - Math.round(price / tick)) < 1e-9;
}

export interface PriceBand {
  basePrice: number;
  /** Highest price an order can be matched at today. */
  limitUp: number;
  /** Lowest price an order can be matched at today. */
  limitDown: number;
  tickSize: number;
  /** The absolute move, in riel, that the band allows. */
  allowedMove: number;
  method: string;
}

/**
 * Today's tradable price band, from the previous close.
 *
 * Below KHR 200 the exchange applies a flat KHR 10 band rather than a
 * percentage, because 10% of a very low price is smaller than one tick.
 */
export function priceBand(basePrice: number): PriceBand {
  const allowedMove =
    basePrice < 200 ? 10 : (basePrice * DAILY_PRICE_LIMIT_PERCENT) / 100;

  return {
    basePrice,
    // Snapped inward so both ends are prices an order can actually name.
    limitUp: roundToTick(basePrice + allowedMove, 'down'),
    limitDown: roundToTick(basePrice - allowedMove, 'up'),
    tickSize: tickSizeFor(basePrice),
    allowedMove,
    method:
      basePrice < 200
        ? 'CSX allows a flat KHR 10 move where the base price is under KHR 200.'
        : `CSX allows ±${DAILY_PRICE_LIMIT_PERCENT}% from the previous close, snapped to the KHR ${tickSizeFor(basePrice)} tick.`,
  };
}

/** How close a price sits to the edge of today's band, as a percentage. */
export function bandPosition(price: number, band: PriceBand): number | null {
  const span = band.limitUp - band.limitDown;
  if (span <= 0) return null;
  return ((price - band.limitDown) / span) * 100;
}

export interface OrderSizing {
  /** Typical traded value per session, in riel. */
  typicalDailyValue: number;
  /** Order value that stays inside `shareOfDailyValue` of a normal session. */
  comfortableValue: number;
  comfortableShares: number;
  shareOfDailyValue: number;
  note: string;
}

/**
 * What size can realistically be traded without becoming the market.
 *
 * This is the binding constraint on CSX, not valuation. Several issuers trade
 * a few hundred shares a session, so an order that would be unremarkable on a
 * larger exchange is the entire day's volume here — and the price it gets is
 * whatever the other side asks.
 *
 * The 10% guide is a convention, not a rule: it is the point beyond which a
 * retail order starts visibly setting the price rather than taking it.
 */
export function orderSizing(
  typicalDailyValue: number,
  price: number,
  shareOfDailyValue = 0.1,
): OrderSizing {
  const comfortableValue = typicalDailyValue * shareOfDailyValue;
  const comfortableShares = price > 0 ? Math.floor(comfortableValue / price) : 0;

  return {
    typicalDailyValue,
    comfortableValue,
    comfortableShares,
    shareOfDailyValue: shareOfDailyValue * 100,
    note:
      comfortableShares < 100
        ? `Around ${comfortableShares.toLocaleString('en-US')} shares is ${shareOfDailyValue * 100}% of a typical session. At this level of trading, almost any order sets the price rather than takes it.`
        : `Around ${comfortableShares.toLocaleString('en-US')} shares is ${shareOfDailyValue * 100}% of a typical session's turnover — beyond that you are likely moving the price yourself.`,
  };
}

/** T+2, skipping weekends. Exchange holidays are not modelled. */
export function settlementDate(tradeDate: string): string {
  const date = new Date(`${tradeDate}T00:00:00.000Z`);
  let added = 0;
  while (added < SETTLEMENT_DAYS) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

/** Describes a band in one sentence for the interface. */
export function describeBand(band: PriceBand): string {
  return `Today's orders must fall between ${round(band.limitDown, 0).toLocaleString('en-US')} and ${round(band.limitUp, 0).toLocaleString('en-US')} riel, in steps of ${band.tickSize}.`;
}
