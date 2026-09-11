import { env } from '../config/env.ts';
import { upstreamUnavailable } from '../core/errors.ts';

/**
 * Client for the public API behind csx.com.kh.
 *
 * This is the exchange's own website feed — the same one the public site reads
 * — and it carries three things nothing else publishes in machine-readable
 * form: the full daily index history back to 2012, every company disclosure,
 * and the structured dividend declarations inside those disclosures.
 */

const TIMEOUT_MS = 30_000;

/** The exchange rate-limits nothing, but a small gap keeps the load polite. */
const MIN_GAP_MS = 120;
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const url = `${env.csxWebApiBase}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json', 'user-agent': 'RielVest/1.0', ...init.headers },
      });
    } catch (error) {
      throw upstreamUnavailable(`Could not reach the CSX website API (${path})`, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      throw upstreamUnavailable(`CSX website API returned ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  };

  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

interface Envelope<T> {
  timestamp: string;
  status: number;
  totalRecords?: number;
  totalPages?: number;
  currentPage?: number;
  data: T;
}

// --- Listed companies ------------------------------------------------------

export interface CsxListedCompany {
  /** Listing date, formatted "10-Dec-2025". */
  date: string | null;
  symbolEn: string;
  symbolKh: string | null;
  icode: string | null;
  nameEn: string | null;
  nameKh: string | null;
}

export async function fetchListedCompanies(): Promise<CsxListedCompany[]> {
  const body = await request<Envelope<CsxListedCompany[]>>('/company/stock/list-companies');
  return body.data ?? [];
}

// --- Index history ---------------------------------------------------------

export interface CsxHistoricalIndexRow {
  /** Formatted "10/09/2026" (day/month/year). */
  date: string;
  value: number | null;
  changePercent: number | null;
  changeUpDown: string | null;
  opening: number | null;
  high: number | null;
  low: number | null;
  /** Grouped strings such as "446,549". */
  totalTradingVolume: string | null;
  totalTradingValue: string | null;
  /** Exchange-wide capitalisation, published in millions of riel. */
  marketCap: string | null;
}

export async function fetchIndexHistory(
  fromDate: string,
  toDate: string,
): Promise<CsxHistoricalIndexRow[]> {
  const query = new URLSearchParams({ fromDate, toDate, investGroup: '001' });
  const body = await request<Envelope<{ historicalIndex: CsxHistoricalIndexRow[] }>>(
    `/market-data/index/daily-closing-index/historical-index?${query}`,
  );
  return body.data?.historicalIndex ?? [];
}

// --- Company disclosures ---------------------------------------------------

export interface CsxAnnouncement {
  id: number;
  no: number;
  title: string;
  /** Formatted "08/09/2026". */
  date: string;
  /** Ticker as CSX writes it; bond issuers appear here too (e.g. "ABC32A"). */
  company: string | null;
}

/** Walks the paginated disclosure archive, newest first. */
export async function fetchAnnouncements(maxPages = 30, limit = 100): Promise<CsxAnnouncement[]> {
  const all: CsxAnnouncement[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const body = await request<Envelope<CsxAnnouncement[]>>(
      `/company/stock/list-companies-announcements?page=${page}&limit=${limit}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    all.push(...(body.data ?? []));
    if (!body.totalPages || page >= body.totalPages) break;
  }

  return all;
}

export interface CsxAnnouncementDetail extends CsxAnnouncement {
  /** HTML body; disclosure figures live in here. */
  content: string | null;
}

export async function fetchAnnouncementDetail(id: number): Promise<CsxAnnouncementDetail | null> {
  const body = await request<Envelope<CsxAnnouncementDetail>>(
    `/company/stock/list-companies-announcements/${id}`,
  );
  return body.data ?? null;
}

export function announcementUrl(id: number): string {
  return `https://csx.com.kh/en/company-information/stock/listed-companies-announcements/${id}`;
}

// --- Daily trade summary ---------------------------------------------------

export interface CsxTradeRow {
  icode: string | null;
  stock: string;
  /** Grouped strings such as "9,140". */
  close: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  /** Magnitude only; the direction is in `changeUpDown`. */
  change: number | null;
  changeUpDown: 'up' | 'down' | 'equal' | string | null;
  volume: string | null;
  value: string | null;
  pe: string | null;
  pb: string | null;
  dividend: number | null;
}

export interface CsxTradeSummary {
  /** The session these figures describe, formatted "10/09/2026". */
  date: string | null;
  marketClosingData: {
    date: string | null;
    volume: string | null;
    value: string | null;
    /** Published in millions of riel. */
    marketCap: string | null;
    fullMarketCap: string | null;
  } | null;
  /** Auction trading method — the ordinary order book. */
  auctionTradingMethod: CsxTradeRow[] | null;
}

/**
 * The exchange's own end-of-session summary.
 *
 * Preferred over the mirror on the open-data portal because it states which
 * session the figures belong to. The portal's copy carries no session date at
 * all, which makes it impossible to tell a fresh close from yesterday's being
 * re-served.
 */
export async function fetchTradeSummary(): Promise<CsxTradeSummary> {
  const body = await request<Envelope<CsxTradeSummary>>('/market-data/stock/trade-summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return body.data;
}

/** Converts the exchange's day-first "10/09/2026" to an ISO date. */
export function parseCsxDayFirst(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
}
