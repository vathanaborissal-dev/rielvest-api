import { averageTurnover } from '../../analysis/liquidity.ts';
import { buildPriceLevels } from '../../analysis/levels.ts';
import { rsi, volumeRatio, type Bar } from '../../analysis/indicators.ts';
import { auctionGuidance } from '../../analysis/orderTicket.ts';
import { buildSessionTicket, typicalSessionRange } from '../../analysis/sessionTicket.ts';
import { orderSizing, priceBand } from '../../analysis/tradingRules.ts';
import { toDateString, toNumber } from '../../core/decimal.ts';
import { CAMBODIA_UTC_OFFSET_MINUTES, daysBetween } from '../../core/dates.ts';
import { mean, pctChange, round } from '../../core/num.ts';
import { prisma } from '../../core/prisma.ts';
import * as repository from './market.repository.ts';
import { getMarketStatus } from './market.status.ts';
import type {
  DigestBoardRow,
  DigestCandidate,
  DigestFreshness,
  DigestMover,
  DigestNewsItem,
  MarketDigest,
  MarketPulse,
} from './market.digest.types.ts';

/**
 * Builds the briefing: what happened, who said something, and which tradeable
 * stock is near a price worth thinking about.
 *
 * The scoring below is a **screen, not a recommendation**. It surfaces stocks
 * that are near a price the market has previously respected, because that is
 * the only situation where "at what price" has a defensible answer — a level
 * the price has actually turned at before. It says nothing about whether the
 * business is worth owning; that is what the company page is for.
 *
 * Every component is listed on the card with its points, so a reader can see
 * what produced the ranking and disagree with it.
 */

/**
 * Liquidity is a gate, not a bonus.
 *
 * An earlier version scored liquidity out of twelve points among a hundred and
 * five, which let counters trading a few hundred dollars a day outrank ACLEDA.
 * They won precisely *because* they are illiquid: a price that barely moves
 * sits permanently next to its own prior low, which the proximity term rewards.
 * A stock the reader cannot take a position in is now excluded outright.
 *
 * The floor is derived rather than picked: a position of `REFERENCE_POSITION_KHR`
 * should be no more than `MAX_SHARE_OF_TURNOVER` of a normal day's trading, or
 * getting in and out is itself the story.
 */
export const REFERENCE_POSITION_KHR = 5_000_000;
export const MAX_SHARE_OF_TURNOVER = 0.2;
export const MIN_DAILY_VALUE_KHR = REFERENCE_POSITION_KHR / MAX_SHARE_OF_TURNOVER;

/**
 * Whether a reader could realistically take and unwind a position.
 *
 * Exported so the gate can be tested directly: it is the single rule that
 * keeps the shortlist pointed at stocks anyone actually trades.
 */
export function isTradeable(typicalDailyValueKhr: number | null): boolean {
  return typicalDailyValueKhr !== null && typicalDailyValueKhr >= MIN_DAILY_VALUE_KHR;
}

/** RSI bounds at which momentum is worth saying out loud. */
const STRETCHED_RSI = 70;
const OVERSOLD_RSI = 30;

interface Assessed {
  symbol: string;
  name: string;
  bars: Bar[];
  latest: Bar;
  changePercent: number | null;
  typicalValue: number;
  todayValue: number | null;
  rsiValue: number | null;
  volume: number | null;
  levels: ReturnType<typeof buildPriceLevels>;
  news: { title: string; date: string } | null;
}

const khr = (value: number): string => round(value, 0).toLocaleString('en-US');
const millions = (value: number): string => `${round(value / 1_000_000, 0)}m`;

export async function buildDigest(language: 'en' | 'km' = 'en'): Promise<MarketDigest> {
  const now = new Date();
  const status = getMarketStatus(now);
  const [companies, barsByCompany, latestDate, indexRows] = await Promise.all([
    repository.listedCompanies(),
    repository.recentBarsByCompany(),
    repository.latestTradeDate(),
    repository.indexHistory('CSX'),
  ]);

  const asOf = toDateString(latestDate);
  const latestIndex = indexRows.at(-1) ?? null;

  // Recent disclosures, so a name with news can be weighted and named.
  const since = new Date(`${asOf ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - 7);
  const events = await prisma.marketEvent.findMany({
    where: { eventDate: { gte: since } },
    orderBy: { eventDate: 'desc' },
    include: { company: { select: { id: true, symbol: true, name: true } } },
  });

  const cleanTitle = (title: string): string =>
    title.replace(/^\[Disclosure\]\s*/i, '').replace(/\s*\(Unofficial Translation\)$/i, '').trim();

  const newsByCompany = new Map<string, { title: string; date: string }>();
  for (const event of events) {
    if (!event.companyId || newsByCompany.has(event.companyId)) continue;
    newsByCompany.set(event.companyId, {
      title: cleanTitle(event.title),
      date: toDateString(event.eventDate)!,
    });
  }

  // ---------------------------------------------------------------------
  // Pass one: assess every listing, without deciding anything yet.
  // ---------------------------------------------------------------------
  const assessed: Assessed[] = [];

  for (const company of companies) {
    const raw = barsByCompany.get(company.id) ?? [];
    const bars: Bar[] = raw.map((quote) => ({
      tradeDate: toDateString(quote.tradeDate)!,
      open: toNumber(quote.openKhr),
      high: toNumber(quote.highKhr),
      low: toNumber(quote.lowKhr),
      close: toNumber(quote.closeKhr)!,
      volume: toNumber(quote.volume),
      value: toNumber(quote.valueKhr),
    }));
    if (bars.length < 20) continue;

    const latest = bars.at(-1)!;
    if (latest.tradeDate !== asOf) continue;
    const previous = bars.at(-2);
    const typicalValue = averageTurnover(bars);
    if (typicalValue === null) continue;

    assessed.push({
      symbol: company.symbol,
      name: company.name,
      bars,
      latest,
      changePercent: previous ? pctChange(previous.close, latest.close) : null,
      typicalValue,
      todayValue: latest.value,
      rsiValue: rsi(bars),
      volume: volumeRatio(bars),
      levels: buildPriceLevels(company.symbol, bars),
      news: newsByCompany.get(company.id) ?? null,
    });
  }

  const tradeable = assessed.filter((entry) => isTradeable(entry.typicalValue));
  const excluded = assessed
    .filter((entry) => !isTradeable(entry.typicalValue))
    .sort((a, b) => b.typicalValue - a.typicalValue)
    .map((entry) => entry.symbol);

  // ---------------------------------------------------------------------
  // What has been going on.
  // ---------------------------------------------------------------------
  const pulse = buildPulse(tradeable, latestIndex);

  const movers: DigestMover[] = tradeable
    .filter((entry) => entry.changePercent !== null && Math.abs(entry.changePercent) >= 0.5)
    .sort((a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!))
    .slice(0, 4)
    .map((entry) => ({
      symbol: entry.symbol,
      name: entry.name,
      price: entry.latest.close,
      changePercent: round(entry.changePercent!, 2),
      turnoverKhr: round(entry.typicalValue, 0),
      volumeRatio: entry.volume === null ? null : round(entry.volume, 1),
      note: moverNote(entry),
    }));

  const tradeableSymbols = new Set(tradeable.map((entry) => entry.symbol));
  const news: DigestNewsItem[] = [];
  const seenTitles = new Set<string>();
  for (const event of events) {
    const title = cleanTitle(event.title);
    const key = `${event.company?.symbol ?? ''}|${title}`;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    const eventDate = toDateString(event.eventDate)!;
    news.push({
      sinceLastSession: asOf !== null && eventDate > asOf,
      symbol: event.company?.symbol ?? event.rawSymbol ?? null,
      name: event.company?.name ?? null,
      title,
      date: eventDate,
      url: event.url,
      tradeable: event.company ? tradeableSymbols.has(event.company.symbol) : false,
    });
    if (news.length >= 8) break;
  }
  // Names a reader can act on first; the rest stays visible below.
  news.sort(
    (a, b) =>
      Number(b.sinceLastSession) - Number(a.sinceLastSession) ||
      Number(b.tradeable) - Number(a.tradeable) ||
      b.date.localeCompare(a.date),
  );

  // ---------------------------------------------------------------------
  // The shortlist, drawn only from the tradeable set.
  // ---------------------------------------------------------------------
  const scored: { candidate: DigestCandidate; score: number }[] = [];

  for (const entry of tradeable) {
    const { levels } = entry;
    const support = levels.nearestStructuralSupport;
    const resistance = levels.nearestStructuralResistance;
    const atrPercent = levels.averageTrueRangePercent;

    // The nearer level of the two, measured against this stock's own volatility
    // so "near" means the same thing for a quiet stock and a jumpy one.
    const reach = atrPercent === null ? 2 : Math.max(1, atrPercent * 1.5);
    const supportDistance = support ? Math.abs(support.distancePercent) : Infinity;
    const resistanceDistance = resistance ? Math.abs(resistance.distancePercent) : Infinity;
    const useSupport = supportDistance <= resistanceDistance;
    const nearest = useSupport ? support : resistance;
    const nearestDistance = useSupport ? supportDistance : resistanceDistance;
    if (!nearest || nearestDistance > reach) continue;

    const parts: { label: string; points: number }[] = [];
    const reasons: string[] = [];
    const cautions: string[] = [];

    // Proximity: the closer to a tested level, the more the level decides.
    const proximityPoints = Math.round(40 * (1 - nearestDistance / reach));
    parts.push({ label: `Within ${round(nearestDistance, 1)}% of a tested level`, points: proximityPoints });

    // A level tested repeatedly is structure; tested once is a data point.
    const touchPoints = Math.min(15, nearest.touches * 5);
    parts.push({ label: `Level tested ${nearest.touches} time(s)`, points: touchPoints });

    // Support is the side where a price has a floor to reference. Resistance
    // is a decision point too, but a worse one to buy into.
    if (useSupport) {
      parts.push({ label: 'Price above the level, not below it', points: 12 });
    } else {
      cautions.push('Price is under resistance — a break has to hold before the level means anything');
    }

    if (entry.news) {
      parts.push({ label: 'Disclosed something this week', points: 18 });
      reasons.push(`${entry.news.title} (${entry.news.date})`);
    }

    // Momentum is stated rather than hidden. The penalty is deliberately
    // smaller than the liquidity gate it used to compete with: being extended
    // is a reason to wait, not a reason to disappear from a twelve-stock market.
    if (entry.rsiValue !== null && entry.rsiValue >= STRETCHED_RSI) {
      parts.push({ label: `Momentum stretched (RSI ${round(entry.rsiValue, 0)})`, points: -12 });
      cautions.push(`Already run hard (RSI ${round(entry.rsiValue, 0)}) — the level being tested may be far below`);
    } else if (entry.rsiValue !== null && entry.rsiValue <= OVERSOLD_RSI) {
      cautions.push(`Heavy selling recently (RSI ${round(entry.rsiValue, 0)}) — check the disclosure feed first`);
    }

    if (entry.volume !== null && entry.volume >= 2) {
      parts.push({ label: `Volume ${round(entry.volume, 1)}x normal`, points: 8 });
      reasons.push(`Traded ${round(entry.volume, 1)}x its usual volume`);
    }

    const score = parts.reduce((total, part) => total + part.points, 0);
    const band = priceBand(entry.latest.close);
    const sizing = orderSizing(entry.typicalValue, entry.latest.close);
    const other = useSupport ? resistance : support;

    // Exchange limits are not a normal day's movement. Keep entry references
    // near the latest close; distant historic levels remain visible separately.
    const typicalRange = typicalSessionRange(entry.bars);
    const ticketFor = (level: typeof support, side: 'buy' | 'sell') =>
      buildSessionTicket({
        side,
        level,
        typicalRange,
        basePrice: entry.latest.close,
        typicalDailyValue: entry.typicalValue,
        tradeDate: asOf,
      });

    scored.push({
      score,
      candidate: {
        symbol: entry.symbol,
        name: entry.name,
        price: entry.latest.close,
        changePercent: entry.changePercent,
        levelLabel: nearest.label,
        levelPrice: nearest.price,
        levelSide: useSupport ? 'support' : 'resistance',
        distancePercent: nearest.distancePercent,
        otherLabel: other?.label ?? null,
        otherPrice: other?.price ?? null,
        reasons,
        cautions,
        limitDown: band.limitDown,
        limitUp: band.limitUp,
        tickSize: band.tickSize,
        tickets: {
          buy: ticketFor(support, 'buy'),
          sell: ticketFor(resistance, 'sell'),
        },
        workableShares: sizing.comfortableShares,
        workableValueKhr:
          sizing.comfortableShares === null
            ? null
            : round(sizing.comfortableShares * entry.latest.close, 0),
        turnoverKhr: round(entry.typicalValue, 0),
        score,
        scoreParts: parts,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score || a.candidate.symbol.localeCompare(b.candidate.symbol));
  const candidates = scored.slice(0, 3).map((entry) => entry.candidate);

  // ---------------------------------------------------------------------
  // The complete tradeable board, so the shortlist is never the whole view.
  // ---------------------------------------------------------------------
  const board: DigestBoardRow[] = tradeable
    .slice()
    .sort((a, b) => b.typicalValue - a.typicalValue)
    .map((entry) => {
      const support = entry.levels.nearestStructuralSupport;
      const resistance = entry.levels.nearestStructuralResistance;
      const supportDistance = support ? Math.abs(support.distancePercent) : Infinity;
      const resistanceDistance = resistance ? Math.abs(resistance.distancePercent) : Infinity;
      const useSupport = supportDistance <= resistanceDistance;
      const nearest = useSupport ? support : resistance;
      const distance = useSupport ? supportDistance : resistanceDistance;
      const atrPercent = entry.levels.averageTrueRangePercent;
      const reach = atrPercent === null ? 2 : Math.max(1, atrPercent * 1.5);

      return {
        symbol: entry.symbol,
        name: entry.name,
        price: entry.latest.close,
        changePercent: entry.changePercent === null ? null : round(entry.changePercent, 2),
        turnoverKhr: round(entry.typicalValue, 0),
        rsi: entry.rsiValue === null ? null : round(entry.rsiValue, 0),
        levelLabel: nearest?.label ?? null,
        levelPrice: nearest?.price ?? null,
        levelSide: nearest ? (useSupport ? 'support' : 'resistance') : null,
        distancePercent: nearest ? round(useSupport ? supportDistance : resistanceDistance, 2) : null,
        state: boardState(entry, nearest !== null && distance <= reach, useSupport),
        hasNews: entry.news !== null,
      } satisfies DigestBoardRow;
    });

  const indexChange = latestIndex ? toNumber(latestIndex.changePercent) : null;
  const marketLine =
    latestIndex === null
      ? 'No session has been recorded yet.'
      : `The market ${
          indexChange === null || indexChange === 0
            ? 'was flat'
            : indexChange > 0
              ? `rose ${round(indexChange, 2)}%`
              : `fell ${round(Math.abs(indexChange), 2)}%`
        }, with ${pulse.advancing} of ${pulse.advancing + pulse.declining} traded stocks higher.`;

  const withNews = news.filter((item) => item.tradeable);
  const newsLine =
    news.length === 0
      ? null
      : withNews.length === 0
        ? `${news.length} disclosure${news.length === 1 ? '' : 's'} this week, none from a stock you could take a position in.`
        : withNews.length === 1
          ? `${withNews[0]!.symbol} disclosed: ${withNews[0]!.title}.`
          : `${withNews.length} tradeable companies disclosed something this week.`;

  return {
    asOf,
    generatedAt: new Date().toISOString(),
    marketOpen: status.isOpen,
    statusLabel: status.label,
    headline: { market: marketLine, news: newsLine, source: 'engine' },
    freshness: buildFreshness(asOf, status, now),
    session: {
      phase: status.phase,
      label: status.label,
      acceptsOrders: status.acceptsOrders,
      nextEvent: status.nextEvent,
      guidance: auctionGuidance(status.phase),
    },
    pulse,
    movers,
    news,
    candidates,
    board,
    universe: {
      assessed: assessed.length,
      tradeable: tradeable.length,
      floorKhr: MIN_DAILY_VALUE_KHR,
      referencePositionKhr: REFERENCE_POSITION_KHR,
      maxShareOfTurnover: MAX_SHARE_OF_TURNOVER,
      excluded,
    },
    criteria:
      `Only stocks trading at least ${millions(MIN_DAILY_VALUE_KHR)} riel a day are considered — enough that ` +
      `a ${millions(REFERENCE_POSITION_KHR)} riel position stays under a fifth of a normal day's volume. ` +
      'Among those, the shortlist ranks proximity to a price the market has previously turned at, whether ' +
      'the company disclosed anything this week, and how heavily it traded. Nothing here judges whether ' +
      'the business is worth owning.',
    emptyReason:
      candidates.length === 0
        ? tradeable.length === 0
          ? `No listed stock traded ${millions(MIN_DAILY_VALUE_KHR)} riel a day over the last month, so there is ` +
            'nothing here a position could be built in.'
          : 'No tradeable stock is currently within a normal day’s move of a level that has held before. ' +
            'That is a real answer: there is no obvious price to act at today.'
        : null,
    caution:
      'A screen, not a recommendation. RielVest shows where prices have mattered before and what the ' +
      'exchange allows today; the decision is yours.',
  };
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Today's date in Cambodia, as YYYY-MM-DD. */
function cambodiaToday(now: Date): string {
  return new Date(now.getTime() + CAMBODIA_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** "Friday 11 Sep", for naming a session a reader may have missed. */
function describeSession(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const day = WEEKDAY[parsed.getUTCDay()]!;
  const month = parsed.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${day} ${parsed.getUTCDate()} ${month}`;
}

/**
 * Names the figures honestly for the moment the page is opened.
 *
 * Four things vary independently — the phase, whether a session has been
 * recorded for today, when the data was last refreshed, and whether it is a
 * weekend — so the heading is computed rather than written into the template.
 */
export function buildFreshness(
  asOf: string | null,
  status: ReturnType<typeof getMarketStatus>,
  now: Date,
): DigestFreshness {
  const today = cambodiaToday(now);
  const isCurrentSession = asOf !== null && asOf === today;
  const named = asOf ? describeSession(asOf) : null;

  if (asOf === null) {
    return {
      sessionDate: null,
      today,
      isCurrentSession: false,
      eyebrow: 'No data yet',
      kicker: 'Nothing recorded',
      staleNote: 'No trading session has been recorded yet.',
    };
  }

  switch (status.phase) {
    case 'pre_open':
      return {
        sessionDate: asOf,
        today,
        isCurrentSession,
        eyebrow: 'Before the bell',
        kicker: isCurrentSession ? 'Where today opened' : `${named}`,
        staleNote: isCurrentSession
          ? null
          : `Figures are from ${named}, the last completed session. Today's trading starts at 09:00.`,
      };

    case 'open':
      return {
        sessionDate: asOf,
        today,
        isCurrentSession,
        eyebrow: 'Market open',
        kicker: isCurrentSession ? 'So far today' : `${named}`,
        staleNote: isCurrentSession
          ? 'Trading is live — these figures move until the 15:00 close.'
          : `Today's session is trading now, but these figures are from ${named} — they update after the 15:00 close.`,
      };

    case 'closing_auction':
      return {
        sessionDate: asOf,
        today,
        isCurrentSession,
        eyebrow: 'Closing auction',
        kicker: isCurrentSession ? 'So far today' : `${named}`,
        staleNote: isCurrentSession
          ? 'The closing auction settles at 15:00, which can still move the close.'
          : `Orders execute at 15:00. These figures are still from ${named}.`,
      };

    case 'weekend':
      return {
        sessionDate: asOf,
        today,
        isCurrentSession: false,
        eyebrow: 'Markets closed',
        kicker: `${named}`,
        staleNote: `The market is shut until Monday 09:00. Everything below is from ${named}, the last session.`,
      };

    default:
      // Closed on a weekday: either the session has ended, or it has not begun.
      return {
        sessionDate: asOf,
        today,
        isCurrentSession,
        eyebrow: isCurrentSession ? 'After the close' : 'Before the bell',
        kicker: isCurrentSession ? 'Today in 30 seconds' : `${named}`,
        staleNote: isCurrentSession
          ? null
          : `Figures are from ${named}, the last completed session — the market has not traded since.`,
      };
  }
}

/** A short state label for scanning the board without reading every column. */
function boardState(entry: Assessed, nearLevel: boolean, useSupport: boolean): string {
  if (entry.rsiValue !== null && entry.rsiValue >= STRETCHED_RSI) return 'Overbought';
  if (entry.rsiValue !== null && entry.rsiValue <= OVERSOLD_RSI) return 'Oversold';
  if (nearLevel) return useSupport ? 'At support' : 'At resistance';
  return 'Mid-range';
}

function moverNote(entry: Assessed): string | null {
  if (entry.news) return 'Disclosed this week';
  if (entry.volume !== null && entry.volume >= 2) return `On ${round(entry.volume, 1)}x normal volume`;
  if (entry.rsiValue !== null && entry.rsiValue >= STRETCHED_RSI) return `RSI ${round(entry.rsiValue, 0)}`;
  if (entry.rsiValue !== null && entry.rsiValue <= OVERSOLD_RSI) return `RSI ${round(entry.rsiValue, 0)}`;
  return null;
}

/**
 * The state of the tradeable market, in the terms a reader would use.
 *
 * Deliberately reports *named* stocks rather than counts: "ACLEDA and Autonomous
 * Port are overbought" is actionable in a way "5 stocks are overbought" is not,
 * and in a twelve-stock market there is room to name them.
 */
function buildPulse(
  tradeable: Assessed[],
  latestIndex: Awaited<ReturnType<typeof repository.indexHistory>>[number] | null,
): MarketPulse {
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  const stretched: string[] = [];
  const oversold: string[] = [];
  let todayTurnover = 0;
  let normalTurnover = 0;
  let haveToday = false;

  for (const entry of tradeable) {
    if (entry.changePercent === null || entry.changePercent === 0) unchanged += 1;
    else if (entry.changePercent > 0) advancing += 1;
    else declining += 1;

    if (entry.rsiValue !== null && entry.rsiValue >= STRETCHED_RSI) stretched.push(entry.symbol);
    if (entry.rsiValue !== null && entry.rsiValue <= OVERSOLD_RSI) oversold.push(entry.symbol);

    if (entry.todayValue !== null && entry.todayValue > 0) {
      todayTurnover += entry.todayValue;
      haveToday = true;
    }
    normalTurnover += entry.typicalValue;
  }

  const turnoverKhr = haveToday ? round(todayTurnover, 0) : null;
  const turnoverVsNormal =
    haveToday && normalTurnover > 0 ? round(todayTurnover / normalTurnover, 2) : null;

  const lines: string[] = [];

  if (advancing + declining > 0) {
    lines.push(
      `${advancing} up, ${declining} down${unchanged > 0 ? `, ${unchanged} unchanged` : ''} ` +
        `among the ${tradeable.length} stocks worth trading.`,
    );
  }

  if (turnoverVsNormal !== null) {
    const descriptor =
      turnoverVsNormal >= 1.5
        ? `busier than usual (${turnoverVsNormal}x)`
        : turnoverVsNormal <= 0.5
          ? `quiet (${turnoverVsNormal}x normal)`
          : 'about normal';
    lines.push(`Turnover was ${descriptor}, ${millions(todayTurnover)} riel across the board.`);
  }

  if (stretched.length > 0) {
    lines.push(
      `${stretched.join(', ')} ${stretched.length === 1 ? 'is' : 'are'} overbought on RSI — ` +
        'buying here means paying up after a run.',
    );
  }
  if (oversold.length > 0) {
    lines.push(
      `${oversold.join(', ')} ${oversold.length === 1 ? 'is' : 'are'} oversold — ` +
        'check the disclosure feed before reading that as cheap.',
    );
  }

  return {
    indexLevel: latestIndex ? toNumber(latestIndex.value) : null,
    indexChangePercent: latestIndex ? toNumber(latestIndex.changePercent) : null,
    advancing,
    declining,
    unchanged,
    turnoverKhr,
    turnoverVsNormal,
    stretched,
    oversold,
    lines,
  };
}

export { buildPriceLevels, daysBetween };
