import { buildPriceLevels } from '../../analysis/levels.ts';
import type { Bar } from '../../analysis/indicators.ts';
import { rangeExtremes, sma, volumeRatio } from '../../analysis/indicators.ts';
import {
  orderSizing,
  priceBand,
  roundToTick,
  settlementDate,
} from '../../analysis/tradingRules.ts';
import { toDateString, toNumber } from '../../core/decimal.ts';
import { daysBetween } from '../../core/dates.ts';
import { mean, median, pctChange, round } from '../../core/num.ts';
import { prisma } from '../../core/prisma.ts';
import * as repository from './market.repository.ts';
import { getMarketStatus } from './market.status.ts';
import type {
  BriefingSignal,
  Evidence,
  KeyPrice,
  MarketBriefing,
  MarketPulse,
  SignalKind,
  TradeConstraints,
} from './market.briefing.types.ts';

/**
 * Builds the pre-session brief.
 *
 * The ordering principle is what a trader can actually act on, in order of how
 * hard it is to undo:
 *
 *  1. **Corporate actions.** A record date is a dated, unavoidable cash event —
 *     miss it and the entitlement is gone, and the price drops by the dividend
 *     on the ex-date whether you were watching or not.
 *  2. **News.** On a twelve-stock exchange one disclosure is a material share
 *     of everything that happened.
 *  3. **Decision points.** Prices sitting on a level the market has previously
 *     respected, where the next session resolves something.
 *  4. **Conditions.** Volume, momentum and liquidity, which colour every
 *     decision above but rarely start one.
 *
 * Nothing here is a recommendation. Each signal states what is true, what it
 * implies, and what would contradict it.
 */

const formatKhr = (value: number): string => `${round(value, 0).toLocaleString('en-US')} KHR`;

const formatBig = (value: number): string =>
  Math.abs(value) >= 1_000_000_000
    ? `${round(value / 1_000_000_000, 2)}bn KHR`
    : Math.abs(value) >= 1_000_000
      ? `${round(value / 1_000_000, 1)}m KHR`
      : formatKhr(value);

/** Base weights, before per-signal adjustment. Higher sorts earlier. */
const KIND_WEIGHT: Record<SignalKind, number> = {
  limit_move: 105,
  dividend_upcoming: 100,
  dividend_declared: 90,
  earnings_report: 80,
  disclosure: 60,
  big_move: 85,
  breakout: 70,
  breakdown: 70,
  range_high: 50,
  range_low: 50,
  volume_surge: 45,
  at_resistance: 30,
  at_support: 30,
  overbought: 35,
  oversold: 35,
  gap: 40,
  illiquid: 20,
};

interface CompanyContext {
  id: string;
  symbol: string;
  name: string;
  bars: Bar[];
  levels: ReturnType<typeof buildPriceLevels>;
}

function buildConstraints(
  bars: Bar[],
  asOf: string | null,
  levels?: ReturnType<typeof buildPriceLevels>,
): TradeConstraints | null {
  const latest = bars.at(-1);
  if (!latest) return null;

  // Today's band is set by the last close, which becomes tomorrow's base price.
  const band = priceBand(latest.close);
  const recentValues = bars
    .slice(-20)
    .map((bar) => bar.value)
    .filter((value): value is number => value !== null && value > 0);
  const typicalDailyValue = mean(recentValues);
  const sizing = typicalDailyValue === null ? null : orderSizing(typicalDailyValue, latest.close);

  return {
    basePrice: latest.close,
    limitUp: band.limitUp,
    limitDown: band.limitDown,
    tickSize: band.tickSize,
    typicalDailyValue,
    comfortableShares: sizing?.comfortableShares ?? null,
    liquidityNote:
      sizing?.note ??
      'No traded value has been recorded recently, so a workable order size cannot be estimated.',
    settlementDate: settlementDate(asOf ?? latest.tradeDate),
    keyPrices: buildKeyPrices(latest.close, band, levels),
  };
}

/**
 * The short list of prices a trader would write down before the open.
 *
 * Every one is snapped to a tick the exchange accepts, so they can be typed
 * into an order straight from the brief. Buy-side references round down and
 * sell-side references round up, so rounding never works against the reader.
 */
function buildKeyPrices(
  close: number,
  band: ReturnType<typeof priceBand>,
  levels?: ReturnType<typeof buildPriceLevels>,
): KeyPrice[] {
  const prices: KeyPrice[] = [];
  const add = (label: string, raw: number, meaning: string, direction: 'down' | 'up') => {
    const price = roundToTick(raw, direction);
    if (!Number.isFinite(price) || price <= 0) return;
    prices.push({
      label,
      price,
      distancePercent: pctChange(close, price) ?? 0,
      meaning,
    });
  };

  add('Previous close', close, 'The base price today\u2019s limits are measured from.', 'down');

  const support = levels?.nearestStructuralSupport;
  if (support) {
    add(
      `Support (${support.label.toLowerCase()})`,
      support.price,
      'Where buyers have stepped in before. A close below it says they no longer are.',
      'down',
    );
  }

  const resistance = levels?.nearestStructuralResistance;
  if (resistance) {
    add(
      `Resistance (${resistance.label.toLowerCase()})`,
      resistance.price,
      'Where sellers have appeared before. Clearing it on volume is what confirms a break.',
      'up',
    );
  }

  const atr = levels?.averageTrueRange;
  if (atr) {
    add(
      'One day\u2019s range below',
      close - atr,
      'A stop inside this distance is likely to be taken out by ordinary noise.',
      'down',
    );
    add(
      'One day\u2019s range above',
      close + atr,
      'A target within this distance is reachable in a single normal session.',
      'up',
    );
  }

  add('Daily limit down', band.limitDown, 'No order can be matched below this today.', 'up');
  add('Daily limit up', band.limitUp, 'No order can be matched above this today.', 'down');

  return prices.sort((a, b) => a.price - b.price);
}

export async function buildBriefing(): Promise<MarketBriefing> {
  const status = getMarketStatus();
  const [companies, barsByCompany, latestDate] = await Promise.all([
    repository.listedCompanies(),
    repository.recentBarsByCompany(),
    repository.latestTradeDate(),
  ]);

  const asOf = toDateString(latestDate);
  const contexts: CompanyContext[] = companies.map((company) => {
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
    return {
      id: company.id,
      symbol: company.symbol,
      name: company.name,
      bars,
      levels: buildPriceLevels(company.symbol, bars),
    };
  });

  const signals: BriefingSignal[] = [
    ...(await corporateActionSignals(contexts, asOf)),
    ...(await disclosureSignals(contexts, asOf)),
    ...priceSignals(contexts, asOf),
  ];

  signals.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  // At most two signals per stock. A stock that is simultaneously overbought,
  // at resistance and on heavy volume is telling one story, not three.
  const perSymbol = new Map<string, number>();
  const ranked = signals.filter((signal) => {
    const count = perSymbol.get(signal.symbol) ?? 0;
    if (count >= 2) return false;
    perSymbol.set(signal.symbol, count + 1);
    return true;
  });
  ranked.forEach((signal, index) => {
    signal.priority = index + 1;
  });

  const flagged = new Set(ranked.map((signal) => signal.symbol));
  const quiet = contexts
    .filter((context) => !flagged.has(context.symbol))
    .map((context) => context.symbol);

  const pulse = await buildPulse(contexts);

  return {
    asOf,
    generatedAt: new Date().toISOString(),
    status: {
      phase: status.phase,
      label: status.label,
      acceptsOrders: status.acceptsOrders,
      nextOpen: status.nextOpen,
    },
    headline: buildHeadline(ranked, pulse, asOf, quiet.length),
    pulse,
    // Anything scoring below a decision point is context, not a call to look.
    focus: ranked.filter((signal) => signal.score >= KIND_WEIGHT.volume_surge).slice(0, 5),
    signals: ranked,
    quiet,
    method:
      'Rebuilt from the recorded sessions and the exchange’s disclosure archive each time it is ' +
      'requested. Corporate actions rank above news, news above price levels, and price levels ' +
      'above momentum — the order in which they constrain a decision.',
    caution:
      'Descriptive only. RielVest states what the published data shows and what would contradict ' +
      'it; it does not recommend trades or predict prices.',
  };
}

// --- 1. Corporate actions --------------------------------------------------

async function corporateActionSignals(
  contexts: CompanyContext[],
  asOf: string | null,
): Promise<BriefingSignal[]> {
  const byId = new Map(contexts.map((context) => [context.id, context]));
  const today = asOf ?? new Date().toISOString().slice(0, 10);

  const dividends = await prisma.dividend.findMany({
    where: { companyId: { in: contexts.map((context) => context.id) } },
    orderBy: [{ recordDate: 'desc' }, { announcementDate: 'desc' }],
    include: { company: { select: { id: true, symbol: true, name: true } } },
  });

  const signals: BriefingSignal[] = [];
  const seen = new Set<string>();

  for (const dividend of dividends) {
    const context = byId.get(dividend.companyId);
    if (!context) continue;

    const amount = toNumber(dividend.amountPerShareKhr)!;
    const recordDate = toDateString(dividend.recordDate);
    const announced = toDateString(dividend.announcementDate);
    const close = context.levels.close;
    const yieldPercent = close && close > 0 ? (amount / close) * 100 : null;

    // An upcoming record date is the one dated, unavoidable event on the
    // calendar: hold through it or the entitlement is gone.
    if (recordDate && recordDate >= today) {
      const daysAway = daysBetween(today, recordDate);
      if (daysAway <= 21 && !seen.has(`${context.symbol}:upcoming`)) {
        seen.add(`${context.symbol}:upcoming`);
        signals.push({
          priority: 0,
          score: KIND_WEIGHT.dividend_upcoming + Math.max(0, 21 - daysAway),
          kind: 'dividend_upcoming',
          symbol: context.symbol,
          name: context.name,
          assessment: 'positive',
          headline: `${context.symbol} record date in ${daysAway} day${daysAway === 1 ? '' : 's'} — ${formatKhr(amount)} per share${yieldPercent ? ` (${round(yieldPercent, 1)}% of price)` : ''}`,
          detail:
            `To receive this dividend you must be a holder on ${recordDate}. Buying on or after the ` +
            `ex-date does not entitle you to it, and settlement is T+2, so a purchase needs to be ` +
            `executed at least two business days before the record date to be registered in time. ` +
            `The price typically falls by roughly the dividend on the ex-date — that drop is the ` +
            `payout leaving the company, not a loss.`,
          evidence: [
            { label: 'Dividend per share', value: formatKhr(amount), provenance: 'reported' },
            { label: 'Record date', value: recordDate, provenance: 'reported' },
            ...(yieldPercent
              ? [
                  {
                    label: 'Share of current price',
                    value: `${round(yieldPercent, 2)}%`,
                    provenance: 'calculated' as const,
                  },
                ]
              : []),
          ],
          constraints: buildConstraints(context.bars, asOf, context.levels),
          sourceUrl: dividend.sourceUrl,
        });
      }
      continue;
    }

    // A declaration made in the last fortnight is still news.
    if (announced && daysBetween(announced, today) <= 14 && !seen.has(`${context.symbol}:declared`)) {
      seen.add(`${context.symbol}:declared`);
      signals.push({
        priority: 0,
        score: KIND_WEIGHT.dividend_declared,
        kind: 'dividend_declared',
        symbol: context.symbol,
        name: context.name,
        assessment: 'positive',
        headline: `${context.symbol} declared ${formatKhr(amount)} per share${yieldPercent ? ` (${round(yieldPercent, 1)}% of price)` : ''}`,
        detail:
          `Declared on ${announced}.` +
          (recordDate
            ? ` The record date of ${recordDate} has already passed, so buying now does not carry an entitlement to this payment.`
            : ' No record date has been disclosed yet; watch for it before assuming an entitlement.'),
        evidence: [
          { label: 'Dividend per share', value: formatKhr(amount), provenance: 'reported' },
          { label: 'Announced', value: announced, provenance: 'reported' },
        ],
        constraints: buildConstraints(context.bars, asOf, context.levels),
        sourceUrl: dividend.sourceUrl,
      });
    }
  }

  return signals;
}

// --- 2. Disclosures --------------------------------------------------------

async function disclosureSignals(
  contexts: CompanyContext[],
  asOf: string | null,
): Promise<BriefingSignal[]> {
  const byId = new Map(contexts.map((context) => [context.id, context]));
  const today = asOf ?? new Date().toISOString().slice(0, 10);
  const since = new Date(`${today}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - 7);

  const events = await prisma.marketEvent.findMany({
    where: {
      companyId: { in: contexts.map((context) => context.id) },
      eventDate: { gte: since },
      // Dividends are already covered, with far more detail, above.
      eventType: { in: ['report', 'announcement', 'listing', 'suspension', 'regulatory'] },
    },
    orderBy: { eventDate: 'desc' },
    take: 12,
  });

  const seen = new Set<string>();
  const signals: BriefingSignal[] = [];

  for (const event of events) {
    const context = byId.get(event.companyId!);
    if (!context || seen.has(context.symbol)) continue;
    seen.add(context.symbol);

    const eventDate = toDateString(event.eventDate)!;
    const isReport = event.eventType === 'report';
    const daysAgo = daysBetween(eventDate, today);

    signals.push({
      priority: 0,
      score: (isReport ? KIND_WEIGHT.earnings_report : KIND_WEIGHT.disclosure) - daysAgo,
      kind: isReport ? 'earnings_report' : 'disclosure',
      symbol: context.symbol,
      name: context.name,
      assessment: event.eventType === 'suspension' ? 'risk' : 'neutral',
      headline: `${context.symbol}: ${event.title.replace(/^\[Disclosure\]\s*/i, '').replace(/\s*\(Unofficial Translation\)$/i, '')}`,
      detail: isReport
        ? `Filed ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`}. Periodic results are the main scheduled information event for a CSX issuer, and on a market this thin they routinely move the price for several sessions afterwards. Read the filing itself — RielVest does not parse figures out of report narratives, because their format varies by issuer and a misread unit would be worse than no number.`
        : `Filed ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`}. Read the filing before acting on any price move that follows it.`,
      evidence: [{ label: 'Filed', value: eventDate, provenance: 'reported' }],
      constraints: buildConstraints(context.bars, asOf, context.levels),
      sourceUrl: event.url,
    });
  }

  return signals;
}

// --- 3. Price and condition signals ----------------------------------------

function priceSignals(contexts: CompanyContext[], asOf: string | null): BriefingSignal[] {
  const signals: BriefingSignal[] = [];

  for (const context of contexts) {
    const { levels, bars, symbol, name } = context;
    const close = levels.close;
    const latest = bars.at(-1);
    if (close === null || !latest || bars.length < 5) continue;

    const previous = bars.at(-2);
    const changePercent = previous ? pctChange(previous.close, close) : null;
    const constraints = buildConstraints(bars, asOf, levels);
    const atr = levels.averageTrueRangePercent;
    // "Near" only means something relative to how far this stock usually moves.

    const volume = volumeRatio(bars);
    const rsiValue = levels.signals.find((signal) => signal.label === 'RSI (14)')?.value ?? null;
    const range = rangeExtremes(bars, 250);
    const support = levels.nearestStructuralSupport;
    const resistance = levels.nearestStructuralResistance;

    const base = { priority: 0, symbol, name, constraints } as const;

    const volumeEvidence: Evidence[] = volume
      ? [{ label: 'Volume vs 20-day average', value: `${round(volume, 1)}x`, provenance: 'calculated' }]
      : [];

    // --- A large move is the first thing a trader needs to know. CSX caps a
    // session at ±10%, so anything past a third of that band is significant
    // here in a way the same percentage would not be on a deeper market.
    if (changePercent !== null && Math.abs(changePercent) >= 3) {
      const band = priceBand(previous!.close);
      const atLimit = close >= band.limitUp || close <= band.limitDown;
      signals.push({
        ...base,
        score:
          (atLimit ? KIND_WEIGHT.limit_move : KIND_WEIGHT.big_move) + Math.min(20, Math.abs(changePercent)),
        kind: atLimit ? 'limit_move' : 'big_move',
        assessment: changePercent > 0 ? 'improving' : 'caution',
        headline: atLimit
          ? `${symbol} closed at its daily ${changePercent > 0 ? 'upper' : 'lower'} price limit, ${changePercent > 0 ? 'up' : 'down'} ${round(Math.abs(changePercent), 1)}%`
          : `${symbol} moved ${changePercent > 0 ? 'up' : 'down'} ${round(Math.abs(changePercent), 1)}% to ${formatKhr(close)}${volume && volume >= 1.5 ? ` on ${round(volume, 1)}x volume` : ''}`,
        detail: atLimit
          ? `CSX caps a session at ±10% of the previous close, and this stock finished at the cap — ` +
            `meaning there were still unfilled orders at the limit when the bell went. Demand that ` +
            `cannot be satisfied in one session often carries into the next, but a limit close also ` +
            `means you could not have transacted beyond ${formatKhr(changePercent > 0 ? band.limitUp : band.limitDown)} ` +
            `whatever you were willing to pay.`
          : `That is ${atr ? `${round(Math.abs(changePercent) / atr, 1)}x this stock's typical daily move` : 'a large single-session move'}, ` +
            `against a ±10% daily limit. ${volume === null ? '' : volume >= 1.5 ? `Volume ran ${round(volume, 1)}x normal, so the move had participation behind it rather than one order crossing a thin book.` : `Volume was only ${round(volume, 1)}x normal, so the move rests on light trading and is easier to reverse.`} ` +
            `Check the disclosure feed before treating it as a trend.`,
        evidence: [
          { label: 'Change', value: `${changePercent > 0 ? '+' : ''}${round(changePercent, 2)}%`, provenance: 'reported' },
          { label: 'Close', value: formatKhr(close), provenance: 'reported' },
          ...(atr ? [{ label: 'Typical daily move', value: `${round(atr, 1)}%`, provenance: 'calculated' as const }] : []),
          ...volumeEvidence,
        ],
      });
    }

    // --- Breakout / breakdown: price has cleared a level that held before.
    const priorHigh = levels.levels.find(
      (level) => level.label === 'Prior high' && level.price < close,
    );
    if (priorHigh && previous && previous.close <= priorHigh.price && volume !== null && volume >= 1.3) {
      signals.push({
        ...base,
        score: KIND_WEIGHT.breakout + (volume >= 2 ? 10 : 0),
        kind: 'breakout',
        assessment: 'improving',
        headline: `${symbol} cleared ${formatKhr(priorHigh.price)}, a level that had turned it back before`,
        detail:
          `The close is above a prior swing high on ${round(volume, 1)}x its usual volume. A level that ` +
          `previously capped the price often acts as support once cleared, which makes ${formatKhr(priorHigh.price)} ` +
          `the natural line to watch: holding above it leaves the move intact, falling back below it ` +
          `means the break did not hold. Volume matters here — a break on thin trading is the ` +
          `easiest kind to reverse.`,
        evidence: [
          { label: 'Level cleared', value: formatKhr(priorHigh.price), provenance: 'calculated' },
          { label: 'Close', value: formatKhr(close), provenance: 'reported' },
          ...volumeEvidence,
        ],
      });
    }

    const priorLow = levels.levels.find(
      (level) => level.label === 'Prior low' && level.price > close,
    );
    if (priorLow && previous && previous.close >= priorLow.price) {
      signals.push({
        ...base,
        score: KIND_WEIGHT.breakdown,
        kind: 'breakdown',
        assessment: 'caution',
        headline: `${symbol} lost ${formatKhr(priorLow.price)}, a level that had held before`,
        detail:
          `The close is below a prior swing low that previously supported the price. Broken support ` +
          `often becomes resistance, so ${formatKhr(priorLow.price)} is the line to watch on any bounce. ` +
          `Regaining it quickly would suggest the break was noise rather than a change of trend.`,
        evidence: [
          { label: 'Level lost', value: formatKhr(priorLow.price), provenance: 'calculated' },
          { label: 'Close', value: formatKhr(close), provenance: 'reported' },
          ...volumeEvidence,
        ],
      });
    }

    // --- Sitting on a level: the next session resolves it either way.
    // A level only counts as a decision point if price is genuinely on top of
    // it and the market has turned there before. Without both, every stock is
    // always "near" something and the brief becomes wallpaper.
    const nearReach = atr === null ? 0.5 : Math.max(0.3, atr * 0.4);

    if (
      resistance &&
      resistance.touches >= 2 &&
      resistance.distancePercent > 0 &&
      resistance.distancePercent <= nearReach
    ) {
      signals.push({
        ...base,
        score: KIND_WEIGHT.at_resistance,
        kind: 'at_resistance',
        assessment: 'neutral',
        headline: `${symbol} is ${round(resistance.distancePercent, 1)}% below ${resistance.label.toLowerCase()} at ${formatKhr(resistance.price)}`,
        detail:
          `${resistance.method} It sits within a normal session's move, so today resolves it: clearing ` +
          `it on volume would confirm a break, while stalling here is where sellers have previously ` +
          `appeared. Buying into an untested level risks paying the high of the range; waiting for a ` +
          `close above it costs some of the move but removes the guess.`,
        evidence: [
          { label: 'Resistance', value: formatKhr(resistance.price), provenance: 'calculated' },
          { label: 'Distance', value: `${round(resistance.distancePercent, 2)}%`, provenance: 'calculated' },
          ...(atr ? [{ label: 'Typical daily move', value: `${round(atr, 1)}%`, provenance: 'calculated' as const }] : []),
        ],
      });
    }

    if (
      support &&
      support.touches >= 2 &&
      support.distancePercent < 0 &&
      Math.abs(support.distancePercent) <= nearReach
    ) {
      signals.push({
        ...base,
        score: KIND_WEIGHT.at_support,
        kind: 'at_support',
        assessment: 'neutral',
        headline: `${symbol} is ${round(Math.abs(support.distancePercent), 1)}% above ${support.label.toLowerCase()} at ${formatKhr(support.price)}`,
        detail:
          `${support.method} The price is within a normal session's move of it, which makes it the ` +
          `natural reference for a decision: holding above it keeps the level intact, and a close ` +
          `below it says the buyers who defended it before are no longer there. A stop set inside ` +
          `one day's range of the level will usually be taken out by ordinary noise.`,
        evidence: [
          { label: 'Support', value: formatKhr(support.price), provenance: 'calculated' },
          { label: 'Distance', value: `${round(Math.abs(support.distancePercent), 2)}%`, provenance: 'calculated' },
          ...(atr ? [{ label: 'Typical daily move', value: `${round(atr, 1)}%`, provenance: 'calculated' as const }] : []),
        ],
      });
    }

    // --- Unusual volume without a price break is worth naming on its own.
    if (volume !== null && volume >= 2.5) {
      signals.push({
        ...base,
        score: KIND_WEIGHT.volume_surge + Math.min(15, volume),
        kind: 'volume_surge',
        assessment: 'neutral',
        headline: `${symbol} traded ${round(volume, 1)}x its usual volume${changePercent !== null ? ` on a ${round(changePercent, 1)}% move` : ''}`,
        detail:
          `Turnover well above normal means something changed the balance of opinion — often a ` +
          `disclosure, sometimes a single large holder. On an exchange where most issuers trade ` +
          `lightly, a volume spike is one of the few genuine signals available. Check the ` +
          `disclosure feed before reading it as conviction.`,
        evidence: [
          ...volumeEvidence,
          ...(latest.value ? [{ label: 'Traded value', value: formatBig(latest.value), provenance: 'reported' as const }] : []),
        ],
      });
    }

    // --- Range extremes and momentum, which colour rather than drive decisions.
    if (range?.positionPercent !== null && range) {
      if (range.positionPercent! >= 97) {
        signals.push({
          ...base,
          score: KIND_WEIGHT.range_high,
          kind: 'range_high',
          assessment: 'caution',
          headline: `${symbol} is at the top of its 52-week range`,
          detail:
            `There is no price above this in the last year, so there is no prior level to act as ` +
            `resistance — which cuts both ways: nothing overhead to stall the move, and no reference ` +
            `point if it turns. The 52-week low of ${formatKhr(range.low)} and the moving averages ` +
            `below are the only structure left.`,
          evidence: [
            { label: '52-week high', value: formatKhr(range.high), provenance: 'calculated' },
            { label: 'Set on', value: range.highDate, provenance: 'reported' },
          ],
        });
      } else if (range.positionPercent! <= 3) {
        signals.push({
          ...base,
          score: KIND_WEIGHT.range_low,
          kind: 'range_low',
          assessment: 'risk',
          headline: `${symbol} is at the bottom of its 52-week range`,
          detail:
            `The price is at or near the lowest it has been in a year. Everyone who bought in the ` +
            `last twelve months is underwater, which tends to produce selling on any rally. A low ` +
            `price is not the same as a cheap one — check whether the fundamentals moved with it.`,
          evidence: [
            { label: '52-week low', value: formatKhr(range.low), provenance: 'calculated' },
            { label: 'Set on', value: range.lowDate, provenance: 'reported' },
          ],
        });
      }
    }

    if (rsiValue !== null && rsiValue >= 80) {
      signals.push({
        ...base,
        score: KIND_WEIGHT.overbought,
        kind: 'overbought',
        assessment: 'caution',
        headline: `${symbol} momentum is stretched (RSI ${round(rsiValue, 0)})`,
        detail:
          `Recent sessions have been almost entirely one-sided. This says nothing about direction — ` +
          `strong trends stay stretched for weeks — but it does mean the easy part of the move has ` +
          `happened, and an entry here is paying up for momentum rather than value.`,
        evidence: [{ label: 'RSI (14)', value: round(rsiValue, 0).toString(), provenance: 'calculated' }],
      });
    } else if (rsiValue !== null && rsiValue <= 20) {
      signals.push({
        ...base,
        score: KIND_WEIGHT.oversold,
        kind: 'oversold',
        assessment: 'caution',
        headline: `${symbol} momentum is heavily negative (RSI ${round(rsiValue, 0)})`,
        detail:
          `Selling has dominated recent sessions. That can precede a bounce, but it can equally mean ` +
          `the market knows something — check the disclosure feed before treating weakness as an ` +
          `opportunity.`,
        evidence: [{ label: 'RSI (14)', value: round(rsiValue, 0).toString(), provenance: 'calculated' }],
      });
    }

    // --- Liquidity is the binding constraint on this market.
    if (constraints?.typicalDailyValue !== null && constraints && constraints.typicalDailyValue! < 10_000_000) {
      signals.push({
        ...base,
        score: KIND_WEIGHT.illiquid,
        kind: 'illiquid',
        assessment: 'risk',
        headline: `${symbol} trades only ${formatBig(constraints.typicalDailyValue!)} a day`,
        detail:
          `${constraints.liquidityNote} At this level, getting out can take longer than getting in, ` +
          `and a market order is the fastest way to pay a bad price. Use limit orders, and size the ` +
          `position so that exiting does not depend on someone appearing on the other side.`,
        evidence: [
          { label: 'Typical daily value', value: formatBig(constraints.typicalDailyValue!), provenance: 'calculated' },
          ...(constraints.comfortableShares !== null
            ? [{ label: 'Workable order size', value: `~${constraints.comfortableShares.toLocaleString('en-US')} shares`, provenance: 'calculated' as const }]
            : []),
        ],
      });
    }
  }

  return signals;
}

// --- Market pulse ----------------------------------------------------------

async function buildPulse(contexts: CompanyContext[]): Promise<MarketPulse> {
  const indexRows = await repository.indexHistory('CSX');
  const latestIndex = indexRows.at(-1) ?? null;

  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let turnover = 0;
  let busiest: { symbol: string; value: number } | null = null;

  for (const context of contexts) {
    const bars = context.bars;
    const latest = bars.at(-1);
    const previous = bars.at(-2);
    if (!latest) continue;

    const change = previous ? latest.close - previous.close : 0;
    if (change > 0) advancing += 1;
    else if (change < 0) declining += 1;
    else unchanged += 1;

    const value = latest.value ?? 0;
    turnover += value;
    if (!busiest || value > busiest.value) busiest = { symbol: context.symbol, value };
  }

  // Turnover means little in isolation on a market this size; the comparison
  // against its own recent average is what says whether today was busy.
  const historicTurnover: number[] = [];
  const dateTotals = new Map<string, number>();
  for (const context of contexts) {
    for (const bar of context.bars.slice(-21, -1)) {
      if (bar.value === null) continue;
      dateTotals.set(bar.tradeDate, (dateTotals.get(bar.tradeDate) ?? 0) + bar.value);
    }
  }
  historicTurnover.push(...dateTotals.values());
  const averageTurnover = mean(historicTurnover);

  const ratios = contexts
    .map((context) => context.bars.at(-1))
    .filter((bar): bar is Bar => bar !== undefined);
  void ratios;

  const medianPeRow = await prisma.stockQuote.findMany({
    where: { pe: { not: null } },
    orderBy: { tradeDate: 'desc' },
    take: 24,
    select: { pe: true, companyId: true },
  });
  const seenCompany = new Set<string>();
  const pes: number[] = [];
  for (const row of medianPeRow) {
    if (seenCompany.has(row.companyId)) continue;
    seenCompany.add(row.companyId);
    const value = toNumber(row.pe);
    if (value !== null && value > 0) pes.push(value);
  }

  const traded = advancing + declining;
  const breadthNote =
    traded === 0
      ? 'Nothing traded in the last recorded session.'
      : advancing > declining * 2
        ? 'Advances clearly outnumbered declines — the move was broad, not driven by one stock.'
        : declining > advancing * 2
          ? 'Declines clearly outnumbered advances — weakness was broad rather than isolated.'
          : 'Advances and declines were close to balanced, so the index move reflects a few names rather than the whole board.';

  return {
    indexValue: latestIndex ? toNumber(latestIndex.value) : null,
    indexChangePercent: latestIndex ? toNumber(latestIndex.changePercent) : null,
    advancing,
    declining,
    unchanged,
    turnover,
    turnoverRatio: averageTurnover && averageTurnover > 0 ? turnover / averageTurnover : null,
    concentrationPercent: busiest && turnover > 0 ? (busiest.value / turnover) * 100 : null,
    concentrationSymbol: busiest?.symbol ?? null,
    medianPe: median(pes),
    breadthNote,
  };
}

function buildHeadline(
  signals: BriefingSignal[],
  pulse: MarketPulse,
  asOf: string | null,
  quietCount: number,
): string[] {
  const lines: string[] = [];

  const indexClause =
    pulse.indexValue === null
      ? 'The index has not been recorded yet.'
      : `The CSX index closed at ${round(pulse.indexValue, 2)}${
          pulse.indexChangePercent === null
            ? ''
            : `, ${pulse.indexChangePercent >= 0 ? 'up' : 'down'} ${round(Math.abs(pulse.indexChangePercent), 2)}%`
        } on ${asOf ?? 'the last recorded session'}.`;
  lines.push(`${indexClause} ${pulse.advancing} rose, ${pulse.declining} fell, ${pulse.unchanged} were unchanged.`);

  if (pulse.turnoverRatio !== null) {
    lines.push(
      pulse.turnoverRatio >= 1.5
        ? `Turnover of ${formatBig(pulse.turnover)} was ${round(pulse.turnoverRatio, 1)}x the recent average — an unusually active session.`
        : pulse.turnoverRatio <= 0.6
          ? `Turnover of ${formatBig(pulse.turnover)} was only ${round(pulse.turnoverRatio, 1)}x the recent average, so the day's moves rest on thin trading.`
          : `Turnover of ${formatBig(pulse.turnover)} was close to the recent average.`,
    );
  }

  if (pulse.concentrationPercent !== null && pulse.concentrationPercent >= 50) {
    lines.push(
      `${pulse.concentrationSymbol} alone took ${round(pulse.concentrationPercent, 0)}% of turnover, so market-wide figures largely describe that one stock.`,
    );
  }

  const top = signals.slice(0, 3);
  if (top.length > 0) {
    lines.push(`Needing attention today: ${top.map((signal) => signal.headline).join('; ')}.`);
  } else {
    lines.push('Nothing on the board is at a decision point, and no issuer has disclosed anything this week.');
  }

  if (quietCount > 0) {
    lines.push(`${quietCount} of the listed stocks show nothing notable.`);
  }

  return lines;
}
