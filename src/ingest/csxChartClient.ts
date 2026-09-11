import { env } from '../config/env.ts';
import { upstreamUnavailable } from '../core/errors.ts';

const TIMEOUT_MS = 20_000;

export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1mo';
export type ChartRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y' | 'max';

export interface CsxChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  value: number;
}

interface RawBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumefrom?: number;
  volume?: number;
  volumeto?: number;
}

interface HistoryResponse {
  Response?: string;
  Message?: string;
  Data?: { Data?: RawBar[] };
}

function upstreamRequest(interval: ChartInterval, requestedLimit: number) {
  if (interval === '1m') return { path: 'histominute', limit: requestedLimit };
  if (interval === '5m') return { path: 'histominute', limit: requestedLimit * 5 };
  if (interval === '15m') return { path: 'histominute', limit: requestedLimit * 15 };
  if (interval === '1h') return { path: 'histohour', limit: requestedLimit };
  if (interval === '1w') return { path: 'histoday', limit: requestedLimit * 5 };
  if (interval === '1mo') return { path: 'histoday', limit: requestedLimit * 22 };
  return { path: 'histoday', limit: requestedLimit };
}

function bucketTime(time: number, interval: ChartInterval): number {
  if (interval === '5m') return Math.floor(time / 300) * 300;
  if (interval === '15m') return Math.floor(time / 900) * 900;
  if (interval === '1h') return Math.floor(time / 3600) * 3600;
  if (interval === '1w') {
    const date = new Date(time * 1000);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysFromMonday);
    date.setUTCHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }
  if (interval === '1mo') {
    const date = new Date(time * 1000);
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
  }
  return time;
}

function aggregateBars(rows: CsxChartBar[], interval: ChartInterval): CsxChartBar[] {
  if (interval === '1m' || interval === '1d') return rows;

  const buckets = new Map<number, CsxChartBar>();
  for (const row of rows) {
    const time = bucketTime(row.time, interval);
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, { ...row, time });
      continue;
    }
    current.high = Math.max(current.high, row.high);
    current.low = Math.min(current.low, row.low);
    current.close = row.close;
    current.volume += row.volume;
    current.value += row.value;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/** Reads the same public chart feed used by trade.csx.com.kh. */
export async function fetchCsxChartBars(
  symbol: string,
  interval: ChartInterval,
  requestedLimit = 300,
): Promise<CsxChartBar[]> {
  const request = upstreamRequest(interval, requestedLimit);
  const query = new URLSearchParams({
    e: 'CSX',
    fsym: symbol.toUpperCase(),
    tsym: 'KHR',
    toTs: String(Math.floor(Date.now() / 1000) + 60),
    limit: String(Math.min(2000, Math.max(20, request.limit))),
    firstDataRequest: 'true',
  });
  const url = `${env.csxChartApiBase}/stock/${request.path}?${query}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${env.csxChartAccessToken}`,
        'user-agent': 'RielVest/1.0',
      },
    });
    if (!response.ok) {
      throw upstreamUnavailable(`CSX chart service returned ${response.status}.`);
    }
    const body = (await response.json()) as HistoryResponse;
    if (body.Response === 'Error') {
      throw upstreamUnavailable(body.Message ?? 'CSX chart service returned an error.');
    }

    const rows = (body.Data?.Data ?? [])
      .map((row): CsxChartBar | null => {
        const values = [row.time, row.open, row.high, row.low, row.close].map(Number);
        if (values.some((value) => !Number.isFinite(value))) return null;
        return {
          time: values[0]!,
          open: values[1]!,
          high: values[2]!,
          low: values[3]!,
          close: values[4]!,
          volume: Number(row.volumefrom ?? row.volume ?? 0),
          value: Number(row.volumeto ?? 0),
        };
      })
      .filter((row): row is CsxChartBar => row !== null)
      .sort((a, b) => a.time - b.time);

    return aggregateBars(rows, interval).slice(-requestedLimit);
  } catch (error) {
    if (error instanceof Error && 'status' in error) throw error;
    throw upstreamUnavailable('Could not reach the CSX chart service.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}
