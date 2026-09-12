import { averageTurnover } from './liquidity.ts';
import { round } from '../core/num.ts';
import { atr, rangeExtremes, rsi, sma, volumeRatio, type Bar } from './indicators.ts';
import { buildPriceLevels, type PriceLevels } from './levels.ts';
import type { OrderTicket } from './orderTicket.ts';
import { buildSessionTicket, typicalSessionRange } from './sessionTicket.ts';
import {
  orderSizing,
  priceBand,
  roundToTick,
  settlementDate,
  tickSizeFor,
} from './tradingRules.ts';

/**
 * The answer to "what prices matter for this stock today".
 *
 * This is a reference card, not a recommendation. It states where the market
 * has previously bought and sold, how far the stock normally travels in a
 * session, and the exchange rules that constrain an order — the four things
 * you need before naming a limit price. Whether to trade at all is the
 * reader's decision; RielVest does not make it and does not score it.
 *
 * Every price is snapped to a tick CSX will accept, with buy-side references
 * rounded down and sell-side rounded up, so the rounding never quietly works
 * against the reader.
 */

export interface PlanZone {
  label: string;
  /** A single price, or the lower bound of a range. */
  from: number;
  /** Upper bound when the zone is a range. */
  to?: number;
  distancePercent: number;
  /** What this price is, in one sentence. */
  meaning: string;
  /** Where it came from, so the reader can disagree with the reasoning. */
  basis: string;
  tone: 'support' | 'resistance' | 'invalidation' | 'neutral';
  /**
   * Whether today's ±10% band permits the price to reach this zone at all.
   *
   * A support zone fifteen percent below the close cannot trade in this
   * session at any size — the exchange does not allow the fall. Shown as a
   * price without that fact, it invites an order that can never fill.
   */
  reachableToday: boolean;
}

export interface TradePlan {
  symbol: string;
  asOf: string | null;
  lastPrice: number | null;
  /** Recent closes for an inline trend shape. */
  spark: number[];
  /**
   * The two orders today actually supports, tick-valid and band-checked — the
   * same construction the briefing uses, so the two pages cannot disagree.
   */
  tickets: { buy: OrderTicket | null; sell: OrderTicket | null };
  /** How far this stock travels in a typical session, in riel and percent. */
  dailyRange: { khr: number; percent: number } | null;
  zones: PlanZone[];
  /** Exchange constraints on any order entered today. */
  rules: {
    limitDown: number;
    limitUp: number;
    tickSize: number;
    settlementDate: string;
    workableShares: number | null;
    workableValue: number | null;
    liquidityNote: string;
  } | null;
  /** Two or three lines summarising the whole card. */
  summary: string[];
  /** Conditions that would make any of the above unreliable. */
  caveats: string[];
  caution: string;
}

const CAUTION =
  'Reference levels calculated from prices CSX has already published. They describe where this ' +
  'stock has traded and what the exchange allows today — not what it will do next, and not a ' +
  'recommendation to buy or sell. RielVest does not give investment advice.';

const khr = (value: number): string => round(value, 0).toLocaleString('en-US');

export function buildTradePlan(symbol: string, bars: Bar[]): TradePlan {
  const levels: PriceLevels = buildPriceLevels(symbol, bars);
  const latest = bars.at(-1) ?? null;
  const close = levels.close;

  if (!latest || close === null || bars.length < 20) {
    return {
      symbol,
      asOf: levels.asOf,
      lastPrice: close,
      spark: bars.slice(-30).map((bar) => bar.close),
      tickets: { buy: null, sell: null },
      dailyRange: null,
      zones: [],
      rules: null,
      summary: [
        `Not enough recorded sessions for ${symbol} to identify levels the market has respected.`,
      ],
      caveats: [`Only ${bars.length} sessions are on record; at least 20 are needed.`],
      caution: CAUTION,
    };
  }

  const trueRange = atr(bars);
  const band = priceBand(close);
  const support = levels.nearestStructuralSupport;
  const resistance = levels.nearestStructuralResistance;
  const yearRange = rangeExtremes(bars, 250);
  const ma50 = sma(bars, 50);
  const rsiValue = rsi(bars);
  const volume = volumeRatio(bars);

  type DraftZone = Omit<PlanZone, 'reachableToday'>;
  const zones: DraftZone[] = [];
  const distance = (price: number) => ((price - close) / close) * 100;

  // --- Where buyers have previously stepped in ------------------------------
  if (support && trueRange) {
    // The zone runs from the level itself up to roughly half a session's move
    // above it — the band within which the level is still the reference.
    const from = roundToTick(support.price, 'down');
    const to = roundToTick(support.price + trueRange * 0.5, 'down');
    zones.push({
      label: 'Support zone',
      from,
      to: to > from ? to : undefined,
      distancePercent: distance(from),
      meaning:
        'The area where buyers have defended this stock before. A limit order placed into it is ' +
        'working with that history rather than chasing the price.',
      basis: support.method,
      tone: 'support',
    });

    // --- The price that says the idea was wrong -----------------------------
    // One full session's range below the level, because a stop set inside one
    // day's normal movement is taken out by noise rather than by being wrong.
    const invalidation = roundToTick(support.price - trueRange, 'down');
    zones.push({
      label: 'Support fails below',
      from: invalidation,
      distancePercent: distance(invalidation),
      meaning:
        `A close below ${khr(invalidation)} means the buyers who held this level are no longer ` +
        'there. Set closer than this and ordinary daily movement will trigger it.',
      basis: `One average true range (${khr(trueRange)} riel) below the support level.`,
      tone: 'invalidation',
    });
  }

  // --- Where sellers have previously appeared -------------------------------
  if (resistance) {
    zones.push({
      label: 'First resistance',
      from: roundToTick(resistance.price, 'up'),
      distancePercent: distance(resistance.price),
      meaning:
        'Where the stock has been turned back before. Clearing it on above-average volume is what ' +
        'distinguishes a break from a failed attempt.',
      basis: resistance.method,
      tone: 'resistance',
    });
  }

  if (yearRange && yearRange.high > close) {
    zones.push({
      label: '52-week high',
      from: roundToTick(yearRange.high, 'up'),
      distancePercent: distance(yearRange.high),
      meaning:
        'The highest the stock has traded in a year. Above it there is no prior level overhead — ' +
        'and no reference point if it turns.',
      basis: `Set on ${yearRange.highDate}.`,
      tone: 'resistance',
    });
  }

  if (ma50 !== null) {
    zones.push({
      label: '50-day average',
      from: roundToTick(ma50, ma50 < close ? 'down' : 'up'),
      distancePercent: distance(ma50),
      meaning:
        ma50 < close
          ? 'The stock is trading above its two-month average. That average often acts as a floor while it holds.'
          : 'The stock is trading below its two-month average, which often acts as a ceiling until reclaimed.',
      basis: 'Mean closing price of the last 50 sessions.',
      tone: ma50 < close ? 'support' : 'resistance',
    });
  }

  // Several measures often land on the same price — a prior low that is also
  // the 50-day average, or a first resistance that is also the 52-week high.
  // Listing them separately implies more independent evidence than exists, so
  // they are merged into one row that names both reasons.
  zones.sort((a, b) => a.from - b.from);
  const merged: DraftZone[] = [];
  for (const zone of zones) {
    const previous = merged.at(-1);
    const withinATick = previous && Math.abs(zone.from - previous.from) <= tickSizeFor(close);
    if (previous && withinATick && previous.tone === zone.tone) {
      previous.label = `${previous.label} · ${zone.label}`;
      // Two measures can share a derivation — a swing low that *is* the 50-day
      // average — in which case repeating the sentence implies two sources.
      if (!previous.basis.includes(zone.basis)) {
        previous.basis = `${previous.basis} ${zone.basis}`;
      }
      previous.to = previous.to ?? zone.to;
      continue;
    }
    merged.push({ ...zone });
  }
  zones.length = 0;
  zones.push(...merged);

  // A zone the daily band cannot reach is not somewhere an order can rest
  // today. Derived once here rather than in each interface that draws the
  // ladder, so the two pages cannot disagree about what is actionable.
  const pricedZones: PlanZone[] = zones.map((zone) => {
    const lowEdge = Math.min(zone.from, zone.to ?? zone.from);
    const highEdge = Math.max(zone.from, zone.to ?? zone.from);
    return {
      ...zone,
      reachableToday: highEdge >= band.limitDown && lowEdge <= band.limitUp,
    };
  });

  // --- What the exchange allows --------------------------------------------
  const typicalValue = averageTurnover(bars);
  const sizing = typicalValue === null ? null : orderSizing(typicalValue, close);

  // --- The quick read -------------------------------------------------------
  const summary: string[] = [];
  summary.push(
    `${symbol} last traded at ${khr(close)} riel${levels.asOf ? ` on ${levels.asOf}` : ''}. ` +
      `Today an order can be matched between ${khr(band.limitDown)} and ${khr(band.limitUp)}, ` +
      `in steps of ${band.tickSize}.`,
  );

  if (support && resistance) {
    summary.push(
      `The nearest level the market has actually respected is ${khr(support.price)} below ` +
        `(${round(Math.abs(support.distancePercent), 1)}% away) and ${khr(resistance.price)} above ` +
        `(${round(resistance.distancePercent, 1)}% away).`,
    );
  }

  if (trueRange) {
    summary.push(
      `A typical session moves about ${khr(trueRange)} riel (${round((trueRange / close) * 100, 1)}%), ` +
        'which is the yardstick for whether a target or a stop is within one day’s reach.',
    );
  }

  if (sizing) {
    summary.push(sizing.note);
  }

  // --- What would make this unreliable --------------------------------------
  const caveats: string[] = [];
  if (typicalValue !== null && typicalValue < 25_000_000) {
    caveats.push(
      `This stock trades only about ${khr(typicalValue / 1_000_000)} million riel a day. At that ` +
        'level the levels below matter less than whether anyone is on the other side of your order.',
    );
  }
  if (rsiValue !== null && rsiValue >= 75) {
    caveats.push(
      `Momentum is stretched (RSI ${round(rsiValue, 0)}). Buying into a support level works less ` +
        'well after a run, because the level being tested may simply be far below.',
    );
  }
  if (volume !== null && volume >= 2.5) {
    caveats.push(
      `The last session traded ${round(volume, 1)}x normal volume. Check the disclosure feed — ` +
        'levels set before news often stop holding after it.',
    );
  }
  if (!support) {
    caveats.push('No level below the current price has turned it before, so there is no tested support to reference.');
  }

  const typicalRange = typicalSessionRange(bars);
  const ticketInput = {
    basePrice: close,
    typicalDailyValue: sizing?.typicalDailyValue ?? null,
    tradeDate: levels.asOf ?? latest.tradeDate,
    typicalRange,
  };

  return {
    symbol,
    asOf: levels.asOf,
    lastPrice: close,
    spark: bars.slice(-30).map((bar) => bar.close),
    tickets: {
      buy: buildSessionTicket({ ...ticketInput, side: 'buy', level: support }),
      sell: buildSessionTicket({ ...ticketInput, side: 'sell', level: resistance }),
    },
    dailyRange: trueRange ? { khr: trueRange, percent: (trueRange / close) * 100 } : null,
    zones: pricedZones,
    rules: {
      limitDown: band.limitDown,
      limitUp: band.limitUp,
      tickSize: tickSizeFor(close),
      settlementDate: settlementDate(levels.asOf ?? latest.tradeDate),
      workableShares: sizing?.comfortableShares ?? null,
      workableValue: sizing?.comfortableValue ?? null,
      liquidityNote:
        sizing?.note ?? 'No traded value recorded recently, so a workable order size cannot be estimated.',
    },
    summary,
    caveats,
    caution: CAUTION,
  };
}
