import type { OrderTicket } from '../../analysis/orderTicket.ts';

/**
 * The thirty-second answer.
 *
 * Three questions, in the order a returning reader asks them:
 *   1. What has happened since I last looked?
 *   2. Has anyone disclosed anything?
 *   3. Which one or two are near a price worth thinking about, and what price?
 *
 * Everything else on the briefing page is detail behind those answers.
 */

export interface DigestHeadline {
  /** One sentence on the session. */
  market: string;
  /** One sentence on disclosures, or null when there were none. */
  news: string | null;
  /** Where the prose came from, so the reader can weigh it. */
  source: 'model' | 'engine';
}

/**
 * Which stocks are worth a reader's attention at all.
 *
 * CSX has twelve listings and a turnover cliff between the seventh and the
 * eighth. Without a gate the shortlist fills with counters that trade a few
 * hundred dollars a day, where a "level" is an artefact of not trading rather
 * than a price anyone defended. The floor is derived, not chosen: it is the
 * turnover at which `referencePositionKhr` is still only `maxShareOfTurnover`
 * of a normal day.
 */
export interface DigestUniverse {
  /** Listings with enough history to assess. */
  assessed: number;
  /** Of those, how many a reader could actually take a position in. */
  tradeable: number;
  /** Minimum 20-day average turnover to qualify, in KHR. */
  floorKhr: number;
  /** The position size the floor is derived from. */
  referencePositionKhr: number;
  /** The share of a day's turnover that position is allowed to be. */
  maxShareOfTurnover: number;
  /** Symbols excluded by the floor, so the omission is visible. */
  excluded: string[];
}

/** How the tradeable half of the market is sitting, beyond the index print. */
export interface MarketPulse {
  indexLevel: number | null;
  indexChangePercent: number | null;
  advancing: number;
  declining: number;
  unchanged: number;
  /** Today's traded value across tradeable names, and its 20-day norm. */
  turnoverKhr: number | null;
  turnoverVsNormal: number | null;
  /** Names running hot or cold, named rather than counted. */
  stretched: string[];
  oversold: string[];
  /** Plain sentences describing the above. The page may show these verbatim. */
  lines: string[];
}

/** A notable move among names a reader could actually trade. */
export interface DigestMover {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  turnoverKhr: number;
  volumeRatio: number | null;
  /** Why this move is worth a glance, when there is a reason beyond size. */
  note: string | null;
}

/** A disclosure, named and attributed rather than tallied. */
export interface DigestNewsItem {
  /** Published after the last session closed — i.e. not yet in any price. */
  sinceLastSession: boolean;
  symbol: string | null;
  name: string | null;
  title: string;
  date: string;
  url: string | null;
  /** Whether this names a stock in the tradeable set. */
  tradeable: boolean;
}

/** One row of the complete tradeable board. */
export interface DigestBoardRow {
  symbol: string;
  name: string;
  price: number;
  changePercent: number | null;
  turnoverKhr: number;
  rsi: number | null;
  levelLabel: string | null;
  levelPrice: number | null;
  levelSide: 'support' | 'resistance' | null;
  distancePercent: number | null;
  /** A two-word state for scanning: "Near support", "Overbought", "Mid-range". */
  state: string;
  hasNews: boolean;
}

/**
 * Whether the figures describe today, and how the page should say so.
 *
 * The session date and the wall clock are independent: at 08:30 on a Monday the
 * newest session is Friday's, and a page headed "Today in 30 seconds" would be
 * presenting Friday's move as this morning's. The heading is therefore derived,
 * never hardcoded.
 */
export interface DigestFreshness {
  /** The session the figures describe. */
  sessionDate: string | null;
  /** The current date in Cambodia, whatever the market is doing. */
  today: string;
  /** True when the figures are from the session happening (or ended) today. */
  isCurrentSession: boolean;
  /** Eyebrow for the page, e.g. "Before the bell". */
  eyebrow: string;
  /** Kicker on the card, e.g. "Friday's close". */
  kicker: string;
  /** Stated whenever the figures are not from a completed session today. */
  staleNote: string | null;
}

/**
 * What the exchange is doing right now, and what that means for an order.
 *
 * The briefing is read at 08:00 as often as after the close, and the same
 * numbers mean different things in each. During the pre-opening auction they
 * are the basis for an order that will price in under an hour; after 15:00
 * they are a record.
 */
export interface DigestSession {
  phase: string;
  label: string;
  /** True while orders can be entered — auctions included, not just trading. */
  acceptsOrders: boolean;
  /** The next thing the exchange will do, and how long until it does it. */
  nextEvent: { label: string; at: string; minutesAway: number } | null;
  /** How matching works in this phase. Two or three lines, phase-specific. */
  guidance: string[];
}

export interface DigestCandidate {
  symbol: string;
  name: string;
  price: number;
  changePercent: number | null;

  /** The level it is closest to, and which side of it the price sits. */
  levelLabel: string;
  levelPrice: number;
  levelSide: 'support' | 'resistance';
  distancePercent: number;

  /** The opposite level, so the reader sees both edges without navigating. */
  otherLabel: string | null;
  otherPrice: number | null;

  /** Why this one surfaced, in the reader's words. Two or three short clauses. */
  reasons: string[];
  /** Anything that argues against it, shown with equal weight. */
  cautions: string[];

  /** What an order today is constrained by. */
  limitDown: number;
  limitUp: number;
  tickSize: number;
  workableShares: number | null;
  /** What `workableShares` is actually worth, so the size is never abstract. */
  workableValueKhr: number | null;
  /** 20-day average turnover, so liquidity is legible on the card. */
  turnoverKhr: number;

  /**
   * The two orders this stock actually supports today, already tick-valid and
   * checked against the daily band. A null side means that level is out of
   * reach in this session.
   */
  tickets: { buy: OrderTicket | null; sell: OrderTicket | null };

  /** The transparent score and its parts, so the ranking can be audited. */
  score: number;
  scoreParts: { label: string; points: number }[];
}

export interface MarketDigest {
  asOf: string | null;
  generatedAt: string;
  marketOpen: boolean;
  statusLabel: string;
  headline: DigestHeadline;
  /** How current the figures are, and what to call them. */
  freshness: DigestFreshness;
  /** The trading phase, the countdown, and how orders match right now. */
  session: DigestSession;
  /** What has been going on — the first question a returning reader asks. */
  pulse: MarketPulse;
  /** Biggest moves among tradeable names. */
  movers: DigestMover[];
  /** Disclosures this week, named. */
  news: DigestNewsItem[];
  /** At most three. An empty list is a real and useful answer. */
  candidates: DigestCandidate[];
  /** Every tradeable stock in one scannable table. */
  board: DigestBoardRow[];
  /** Who was eligible and why. */
  universe: DigestUniverse;
  /** Stated plainly on the card: what the shortlist was selected on. */
  criteria: string;
  /** Why nothing qualified, when nothing did. */
  emptyReason: string | null;
  caution: string;
}
