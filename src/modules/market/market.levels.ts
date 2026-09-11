import { buildPriceLevels, type PriceLevels } from '../../analysis/levels.ts';
import type { Bar } from '../../analysis/indicators.ts';
import { toDateString, toNumber } from '../../core/decimal.ts';
import { pctChange, round } from '../../core/num.ts';
import type { Assessment } from '../../analysis/types.ts';
import * as repository from './market.repository.ts';

/**
 * A one-screen scan of every listed stock.
 *
 * The company page shows one stock in depth; this is the board you read first —
 * where each stock closed, the nearest level either side of it, and whether
 * anything unusual happened in the session. Recomputed on every request from
 * the recorded sessions, so it moves with the market.
 */

export interface LevelsBoardRow {
  symbol: string;
  name: string;
  sector: string | null;
  board: 'main' | 'growth';
  tradeDate: string | null;
  close: number | null;
  changePercent: number | null;
  /** Levels the market has actually reacted to — the ones worth reading. */
  supportLabel: string | null;
  support: number | null;
  supportDistancePercent: number | null;
  resistanceLabel: string | null;
  resistance: number | null;
  resistanceDistancePercent: number | null;
  /** Today's intraday reference triplet, derived from yesterday's range. */
  pivots: { s1: number; pivot: number; r1: number } | null;
  rsi: number | null;
  volumeRatio: number | null;
  rangePositionPercent: number | null;
  atrPercent: number | null;
  /** A single sentence summarising the session. */
  read: string;
  /** What stands out, if anything: drives the highlight styling. */
  flags: { label: string; assessment: Assessment }[];
}

function signalValue(levels: PriceLevels, label: string): number | null {
  return levels.signals.find((signal) => signal.label === label)?.value ?? null;
}

function buildRead(row: Omit<LevelsBoardRow, 'read' | 'flags'>): string {
  if (row.close === null) return 'No recorded session for this stock yet.';

  const parts: string[] = [];
  const move =
    row.changePercent === null || row.changePercent === 0
      ? 'closed unchanged'
      : row.changePercent > 0
        ? `closed up ${round(row.changePercent, 1)}%`
        : `closed down ${round(Math.abs(row.changePercent), 1)}%`;
  parts.push(`${move} at ${round(row.close, 0).toLocaleString('en-US')} riel`);

  if (row.volumeRatio !== null && row.volumeRatio >= 2) {
    parts.push(`on ${round(row.volumeRatio, 1)}x normal volume`);
  } else if (row.volumeRatio !== null && row.volumeRatio <= 0.4) {
    parts.push('on thin volume');
  }

  const withinReach = row.atrPercent === null ? 1 : Math.max(0.5, row.atrPercent * 0.75);
  if (
    row.resistance !== null &&
    row.resistanceDistancePercent !== null &&
    row.resistanceDistancePercent <= withinReach
  ) {
    parts.push(
      `within reach of ${row.resistanceLabel?.toLowerCase()} at ${round(row.resistance, 0).toLocaleString('en-US')}`,
    );
  } else if (
    row.support !== null &&
    row.supportDistancePercent !== null &&
    Math.abs(row.supportDistancePercent) <= withinReach
  ) {
    parts.push(
      `sitting on ${row.supportLabel?.toLowerCase()} at ${round(row.support, 0).toLocaleString('en-US')}`,
    );
  }

  return `${parts.join(', ')}.`;
}

function buildFlags(row: Omit<LevelsBoardRow, 'read' | 'flags'>): LevelsBoardRow['flags'] {
  const flags: LevelsBoardRow['flags'] = [];

  if (row.rsi !== null && row.rsi >= 70) flags.push({ label: 'Overbought', assessment: 'caution' });
  if (row.rsi !== null && row.rsi <= 30) flags.push({ label: 'Oversold', assessment: 'caution' });
  if (row.volumeRatio !== null && row.volumeRatio >= 2) {
    flags.push({ label: 'Unusual volume', assessment: 'improving' });
  }
  if (row.rangePositionPercent !== null && row.rangePositionPercent >= 95) {
    flags.push({ label: 'At 52-week high', assessment: 'improving' });
  }
  if (row.rangePositionPercent !== null && row.rangePositionPercent <= 5) {
    flags.push({ label: 'At 52-week low', assessment: 'risk' });
  }
  // "Testing" only means something relative to how far this stock normally
  // travels in a day. A fixed percentage would fire on every quiet stock and
  // never on a volatile one.
  const withinReach = row.atrPercent === null ? 1 : Math.max(0.5, row.atrPercent * 0.75);

  if (
    row.resistanceDistancePercent !== null &&
    row.resistanceDistancePercent > 0 &&
    row.resistanceDistancePercent <= withinReach
  ) {
    flags.push({ label: 'Testing resistance', assessment: 'neutral' });
  }
  if (
    row.supportDistancePercent !== null &&
    row.supportDistancePercent < 0 &&
    Math.abs(row.supportDistancePercent) <= withinReach
  ) {
    flags.push({ label: 'Testing support', assessment: 'neutral' });
  }

  return flags;
}

export async function getLevelsBoard(): Promise<{
  asOf: string | null;
  rows: LevelsBoardRow[];
  method: string;
  caution: string;
}> {
  const [companies, barsByCompany] = await Promise.all([
    repository.listedCompanies(),
    repository.recentBarsByCompany(),
  ]);

  const rows: LevelsBoardRow[] = [];
  let asOf: string | null = null;

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

    const levels = buildPriceLevels(company.symbol, bars);
    const latest = raw.at(-1);
    const change = latest ? toNumber(latest.changeKhr) : null;
    const close = levels.close;
    if (levels.asOf && (!asOf || levels.asOf > asOf)) asOf = levels.asOf;

    const base = {
      symbol: company.symbol,
      name: company.name,
      sector: company.sector,
      board: company.board,
      tradeDate: levels.asOf,
      close,
      changePercent:
        change === null || close === null ? null : pctChange(close - change, close),
      supportLabel: levels.nearestStructuralSupport?.label ?? null,
      support: levels.nearestStructuralSupport?.price ?? null,
      supportDistancePercent: levels.nearestStructuralSupport?.distancePercent ?? null,
      resistanceLabel: levels.nearestStructuralResistance?.label ?? null,
      resistance: levels.nearestStructuralResistance?.price ?? null,
      resistanceDistancePercent: levels.nearestStructuralResistance?.distancePercent ?? null,
      pivots: levels.pivots
        ? { s1: levels.pivots.s1, pivot: levels.pivots.pivot, r1: levels.pivots.r1 }
        : null,
      rsi: signalValue(levels, 'RSI (14)'),
      volumeRatio: signalValue(levels, 'Volume versus normal'),
      rangePositionPercent: signalValue(levels, 'Position in 52-week range'),
      atrPercent: levels.averageTrueRangePercent,
    };

    rows.push({ ...base, read: buildRead(base), flags: buildFlags(base) });
  }

  // Anything flagged rises to the top: that is what a reader scans for.
  rows.sort((a, b) => b.flags.length - a.flags.length || a.symbol.localeCompare(b.symbol));

  return {
    asOf,
    rows,
    method:
      'Levels and signals are recalculated from the daily bars CSX publishes each time this board is requested.',
    caution:
      'Reference levels calculated from published prices. They describe where each stock has traded, not where it will trade. RielVest does not give buy or sell advice.',
  };
}
