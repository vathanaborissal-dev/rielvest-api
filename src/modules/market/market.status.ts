import { CAMBODIA_UTC_OFFSET_MINUTES } from '../../core/dates.ts';

/**
 * Whether CSX is trading right now.
 *
 * The live trade stream only pushes messages while the order book is open, so
 * without this the interface has no way to distinguish "no trades yet" from
 * "the market closed four hours ago" — and shows an indefinite "waiting"
 * either way.
 *
 * CSX runs weekdays in Cambodian time (ICT, a fixed UTC+7 with no daylight
 * saving), in three phases:
 *
 *   08:00-09:00  pre-opening call auction, executed at 09:00
 *   09:00-14:50  continuous trading
 *   14:50-15:00  closing call auction, executed at 15:00
 *
 * These are confirmed against the exchange's own intraday feed: every recent
 * session's minute bars run from exactly 09:00 to 15:00.
 *
 * Exchange holidays are not modelled. CSX publishes them on its own calendar,
 * and treating a holiday as a quiet trading day is a far smaller error than
 * telling someone a closed market is open.
 */

export const PRE_OPEN_MINUTES = 8 * 60;
export const OPEN_MINUTES = 9 * 60;
export const CLOSING_AUCTION_MINUTES = 14 * 60 + 50;
export const CLOSE_MINUTES = 15 * 60;

export type MarketPhase = 'pre_open' | 'open' | 'closing_auction' | 'closed' | 'weekend';

export interface MarketStatus {
  phase: MarketPhase;
  /** True while continuous trading is running. */
  isOpen: boolean;
  /** True whenever orders can still be entered, auctions included. */
  acceptsOrders: boolean;
  /** Plain sentence for the interface, e.g. "Closed — opens Monday 09:00". */
  label: string;
  /** Local Cambodian time, "HH:MM". */
  localTime: string;
  /** ISO instant of the next open, or null while trading. */
  nextOpen: string | null;
  /**
   * The next thing the exchange will do, and how far away it is.
   *
   * At 08:00 the figure that matters is not "the market opens at 09:00" but
   * "the auction executes in 47 minutes" — the window to enter or amend an
   * order before it is priced.
   */
  nextEvent: { label: string; at: string; minutesAway: number } | null;
  timezone: string;
  sessionHours: string;
}

/** Minutes since midnight in Cambodia, and the local weekday. */
function cambodiaClock(now: Date): { minutes: number; weekday: number; hhmm: string } {
  const shifted = new Date(now.getTime() + CAMBODIA_UTC_OFFSET_MINUTES * 60_000);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return {
    minutes,
    weekday: shifted.getUTCDay(),
    hhmm: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`,
  };
}

/** The next weekday 09:00 Cambodian time, as a UTC instant. */
function nextOpenInstant(now: Date): Date {
  const shifted = new Date(now.getTime() + CAMBODIA_UTC_OFFSET_MINUTES * 60_000);
  const candidate = new Date(shifted);
  candidate.setUTCHours(9, 0, 0, 0);

  // If today's open has already passed, or today is a weekend, roll forward.
  const alreadyPassed = shifted.getTime() >= candidate.getTime();
  if (alreadyPassed) candidate.setUTCDate(candidate.getUTCDate() + 1);
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return new Date(candidate.getTime() - CAMBODIA_UTC_OFFSET_MINUTES * 60_000);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A UTC instant for `minutes` past midnight Cambodian time, on `now`'s day. */
function cambodiaInstant(now: Date, minutes: number): Date {
  const shifted = new Date(now.getTime() + CAMBODIA_UTC_OFFSET_MINUTES * 60_000);
  shifted.setUTCHours(0, minutes, 0, 0);
  return new Date(shifted.getTime() - CAMBODIA_UTC_OFFSET_MINUTES * 60_000);
}

export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const { minutes, weekday, hhmm } = cambodiaClock(now);
  const isWeekend = weekday === 0 || weekday === 6;

  const phase: MarketPhase = isWeekend
    ? 'weekend'
    : minutes >= OPEN_MINUTES && minutes < CLOSING_AUCTION_MINUTES
      ? 'open'
      : minutes >= CLOSING_AUCTION_MINUTES && minutes < CLOSE_MINUTES
        ? 'closing_auction'
        : minutes >= PRE_OPEN_MINUTES && minutes < OPEN_MINUTES
          ? 'pre_open'
          : 'closed';

  const nextOpen = phase === 'open' ? null : nextOpenInstant(now);
  const nextOpenLocal = nextOpen
    ? new Date(nextOpen.getTime() + CAMBODIA_UTC_OFFSET_MINUTES * 60_000)
    : null;
  const nextOpenDay = nextOpenLocal ? WEEKDAY_NAMES[nextOpenLocal.getUTCDay()]! : '';

  const label =
    phase === 'open'
      ? `Open — continuous trading until 14:50 (${hhmm} in Phnom Penh)`
      : phase === 'closing_auction'
        ? `Closing auction — orders execute at 15:00 (${hhmm} in Phnom Penh)`
        : phase === 'pre_open'
          ? `Pre-opening auction — orders execute at 09:00 (${hhmm} in Phnom Penh)`
          : phase === 'weekend'
            ? `Closed for the weekend — reopens ${nextOpenDay} at 09:00`
            : minutes >= CLOSE_MINUTES
              ? `Closed — today's session ended at 15:00, reopens ${nextOpenDay} at 09:00`
              : `Closed — opens ${nextOpenDay} at 09:00`;

  const nextEvent = (() => {
    const at =
      phase === 'pre_open'
        ? { label: 'Auction executes', instant: cambodiaInstant(now, OPEN_MINUTES) }
        : phase === 'open'
          ? { label: 'Closing auction begins', instant: cambodiaInstant(now, CLOSING_AUCTION_MINUTES) }
          : phase === 'closing_auction'
            ? { label: 'Closing auction executes', instant: cambodiaInstant(now, CLOSE_MINUTES) }
            : nextOpen === null
              ? null
              // Order entry reopens with the pre-opening auction, an hour
              // before the market itself opens.
              : { label: 'Pre-opening auction opens', instant: new Date(nextOpen.getTime() - 60 * 60_000) };

    if (at === null) return null;
    return {
      label: at.label,
      at: at.instant.toISOString(),
      minutesAway: Math.max(0, Math.round((at.instant.getTime() - now.getTime()) / 60_000)),
    };
  })();

  return {
    phase,
    isOpen: phase === 'open',
    acceptsOrders: phase === 'open' || phase === 'pre_open' || phase === 'closing_auction',
    label,
    localTime: hhmm,
    nextOpen: nextOpen?.toISOString() ?? null,
    nextEvent,
    timezone: 'Asia/Phnom_Penh (UTC+7)',
    sessionHours:
      'Monday to Friday. Pre-opening auction 08:00–09:00, continuous trading 09:00–14:50, ' +
      'closing auction 14:50–15:00.',
  };
}
