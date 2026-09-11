import type { Bar } from './indicators.ts';
import { median } from '../core/num.ts';
import { buildOrderTicket, type OrderTicket, type OrderTicketInput } from './orderTicket.ts';
import { roundToTick } from './tradingRules.ts';

/** Median true range: twenty complete sessions, including gaps and quiet days.
 * Unlike the exchange band, this describes observed movement. Using the median
 * keeps one unusually large session from setting every subsequent entry price.
 */
export function typicalSessionRange(bars: Bar[]): number | null {
  const window = bars.slice(-21);
  if (window.length < 21) return null;
  const ranges: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const bar = window[i]!;
    const previousClose = window[i - 1]!.close;
    if (bar.high === null || bar.low === null ||
        ![bar.high, bar.low, bar.close, previousClose].every(Number.isFinite) ||
        bar.low <= 0 || previousClose <= 0 || bar.high < bar.low ||
        bar.close < bar.low || bar.close > bar.high) return null;
    ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)));
  }
  return median(ranges);
}

/** A nearby reference scenario, not a forecast of an executable bid or ask. */
export function buildSessionTicket(
  input: Omit<OrderTicketInput, 'targetPrice' | 'label'> & {
    level: { price: number; label: string } | null;
    typicalRange: number | null;
  },
): OrderTicket | null {
  const { side, basePrice, level, typicalRange } = input;
  if (!Number.isFinite(basePrice) || basePrice <= 0 || typicalRange === null ||
      !Number.isFinite(typicalRange) || typicalRange <= 0) return null;

  const direction = side === 'buy' ? -1 : 1;
  const nearby = level ? roundToTick(level.price, side === 'buy' ? 'down' : 'up') : null;
  const nearbyDistance = nearby === null ? null : (nearby - basePrice) * direction;
  const useLevel = nearbyDistance !== null && nearbyDistance > 0 && nearbyDistance <= typicalRange;
  // If historic support is distant, use an explicitly calculated half-range
  // pullback instead. Round toward the close so a tick cannot enlarge the move.
  const target = useLevel ? nearby! : roundToTick(
    basePrice + direction * typicalRange / 2, side === 'buy' ? 'up' : 'down',
  );
  const distance = (target - basePrice) * direction;
  if (!Number.isFinite(target) || target <= 0 || distance <= 0 || distance > typicalRange) return null;

  const ticket = buildOrderTicket({
    ...input, targetPrice: target,
    label: useLevel ? level!.label : side === 'buy' ? 'Half-range pullback' : 'Half-range rebound',
  });
  if (!ticket.reachableToday) return null;
  return {
    ...ticket,
    distanceKhr: target - basePrice,
    typicalRangeKhr: typicalRange,
    referenceBasis: useLevel
      ? 'Historical level within one recent daily range of the last close.'
      : 'Calculated scenario half a recent daily range from the last close; not a tested support or resistance level.',
  };
}
