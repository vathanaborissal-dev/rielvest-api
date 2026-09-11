import { orderSizing, priceBand, roundToTick, settlementDate, tickSizeFor } from './tradingRules.ts';

/**
 * Turning a price level into an order a broker would actually accept.
 *
 * A level is an observation about where the market has turned. An order is a
 * number typed into a broker's form, and the exchange rejects most numbers: it
 * must sit on the tick grid, and it must fall inside today's ±10% band. Those
 * two constraints are why "support is at 7,840" and "you can buy at 7,840" are
 * different claims, and only the second one matters at 08:00.
 *
 * The unreachable case is the important one. A support level below today's
 * floor cannot be traded at in this session at any size — the stock is not
 * permitted to fall that far before tomorrow. Showing that price without the
 * constraint invites an order that will never fill.
 */

export type TicketSide = 'buy' | 'sell';

export interface OrderTicket {
  /** Present for near-term scenarios, measured from the recorded close. */
  distanceKhr?: number;
  /** Median true range of the latest twenty complete sessions. */
  typicalRangeKhr?: number;
  referenceBasis?: string;
  side: TicketSide;
  /** What the price references, e.g. "Support zone". */
  label: string;
  /** The level as the analysis computed it, before any exchange constraint. */
  targetPrice: number;
  /**
   * The price actually enterable today: on the tick grid and inside the band.
   * Null when the level cannot be reached in this session at all.
   */
  limitPrice: number | null;
  tickSize: number;
  bandFloor: number;
  bandCeiling: number;
  /** False when the level sits outside what today's band permits. */
  reachableToday: boolean;
  /** Says why, and by how much, when the level is out of reach. */
  unreachableNote: string | null;
  /** How far rounding to a valid tick moved the price, in riel. */
  tickAdjustment: number;
  /** A size that stays a modest share of normal turnover. */
  shares: number | null;
  valueKhr: number | null;
  /** T+2 from the next session. */
  settlesOn: string | null;
}

export interface OrderTicketInput {
  side: TicketSide;
  label: string;
  targetPrice: number;
  /** Previous close — the band is measured from it, not from the level. */
  basePrice: number;
  /** 20-day average turnover, for sizing. Omit to leave size unstated. */
  typicalDailyValue?: number | null;
  /** The session the order would trade in, for settlement. */
  tradeDate?: string | null;
}

const khr = (value: number): string => Math.round(value).toLocaleString('en-US');

export function buildOrderTicket(input: OrderTicketInput): OrderTicket {
  const { side, label, targetPrice, basePrice } = input;
  const band = priceBand(basePrice);

  // A buy rounds down and a sell rounds up: in both directions the trader ends
  // up with the better side of the tick rather than paying for the rounding.
  const rounded = roundToTick(targetPrice, side === 'buy' ? 'down' : 'up');

  // Reachability is directional. A buy needs the price to come down to the
  // level, so only the floor can block it; a sell needs it to rise.
  const belowFloor = rounded < band.limitDown;
  const aboveCeiling = rounded > band.limitUp;
  const reachableToday = !belowFloor && !aboveCeiling;

  let unreachableNote: string | null = null;
  if (belowFloor) {
    unreachableNote =
      `${khr(targetPrice)} is below today's floor of ${khr(band.limitDown)}. ` +
      `The exchange does not allow a fall of more than ${khr(band.allowedMove)} riel from ` +
      `${khr(basePrice)}, so this price cannot trade in one session.`;
  } else if (aboveCeiling) {
    unreachableNote =
      `${khr(targetPrice)} is above today's ceiling of ${khr(band.limitUp)}. ` +
      `The exchange does not allow a rise of more than ${khr(band.allowedMove)} riel from ` +
      `${khr(basePrice)}, so this price cannot trade in one session.`;
  }

  const limitPrice = reachableToday ? rounded : null;
  const sizing =
    input.typicalDailyValue != null && input.typicalDailyValue > 0 && limitPrice !== null
      ? orderSizing(input.typicalDailyValue, limitPrice)
      : null;

  return {
    side,
    label,
    targetPrice,
    limitPrice,
    tickSize: tickSizeFor(basePrice),
    bandFloor: band.limitDown,
    bandCeiling: band.limitUp,
    reachableToday,
    unreachableNote,
    tickAdjustment: reachableToday ? Math.abs(rounded - targetPrice) : 0,
    shares: sizing?.comfortableShares ?? null,
    valueKhr:
      sizing && limitPrice !== null ? Math.round(sizing.comfortableShares * limitPrice) : null,
    settlesOn: input.tradeDate ? settlementDate(input.tradeDate) : null,
  };
}

/**
 * What the exchange is doing to your order right now, in the trader's terms.
 *
 * The pre-opening and closing sessions are single-price call auctions: orders
 * collect for the whole window and execute together at one price. Two
 * consequences are worth stating, because neither is obvious and both change
 * how an order should be entered:
 *
 *  - A buy limit above the opening price still fills *at* the opening price.
 *    Bidding up is therefore cheaper here than it is in continuous trading.
 *  - Matching is price priority, then time priority. At the same price, the
 *    order entered at 08:02 is ahead of the one entered at 08:58.
 *
 * Verified against CSX's published trading rules: 08:00–09:00 single-price
 * auction executing at 09:00, 09:00–14:50 continuous, 14:50–15:00 single-price
 * auction executing at 15:00.
 */
export function auctionGuidance(phase: string): string[] {
  switch (phase) {
    case 'pre_open':
      return [
        'Orders collect until 09:00 and execute together at one opening price.',
        'A buy limit above that price still fills at the opening price, not at your limit.',
        'Same price, earlier order wins — enter early rather than large.',
      ];
    case 'open':
      return [
        'Continuous trading: your order matches as soon as a counterparty meets it.',
        'A market order takes whatever is on the book, which on thin stocks can be far from the last trade.',
      ];
    case 'closing_auction':
      return [
        'Orders collect until 15:00 and execute together at one closing price.',
        'This price becomes tomorrow’s reference, so tomorrow’s ±10% band is measured from it.',
      ];
    default:
      return [
        'The order book is closed. The next chance to enter an order is the pre-opening auction, which opens at 08:00 and prices at 09:00.',
      ];
  }
}
