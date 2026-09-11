import { env } from '../config/env.ts';
import { upstreamUnavailable } from '../core/errors.ts';
import { portalFetch } from './httpAgent.ts';

const DEFAULT_TIMEOUT_MS = 30_000;

type PortalResponse = Awaited<ReturnType<typeof portalFetch>>;

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> = {},
): Promise<PortalResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await portalFetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'RielVest/1.0', ...headers },
    });
  } catch (error) {
    throw upstreamUnavailable(`Could not reach the Cambodian open-data portal (${url})`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const url = `${env.mefApiBase}${path}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw upstreamUnavailable(`Open-data portal returned ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

// --- Real-time endpoints ---------------------------------------------------
// Each returns only the most recent session; there is no history parameter.

export interface CsxSummaryRow {
  id: number;
  name: string;
  icode: string | null;
  stock: string;
  created_at: string;
  close: string | null;
  open_price: string | null;
  high: string | null;
  low: string | null;
  /** Magnitude only — the direction lives in `change_up_down`. */
  change: number | null;
  change_up_down: 'up' | 'down' | 'equal' | string | null;
  volume: string | null;
  value: string | null;
  pe: string | null;
  pb: string | null;
  dividend: number | null;
}

export function fetchCsxSummary(): Promise<{ data: CsxSummaryRow[] }> {
  return getJson('/realtime-api/csx-summary');
}

export interface CsxIndexRow {
  id: number;
  created_at: string;
  date: string;
  value: number;
  change: number | null;
  change_percent: number | null;
  change_up_down: 'up' | 'down' | 'equal' | string | null;
  index_time: string | null;
  opening: number | null;
  high: number | null;
  low: number | null;
  trading_volume: number | null;
  trading_value: number | null;
  market_cap: number | null;
}

export function fetchCsxIndex(): Promise<{ data: CsxIndexRow }> {
  return getJson('/realtime-api/csx-index');
}

export interface ExchangeRateRow {
  id: number;
  valid_date: string;
  created_at: string;
  currency_id: string;
  currency: string;
  symbol: string;
  unit: number;
  bid: number | null;
  ask: number | null;
  average: number | null;
}

export function fetchExchangeRates(): Promise<{ data: ExchangeRateRow[] }> {
  return getJson('/realtime-api/exchange-rate');
}

// --- Dataset files ---------------------------------------------------------

/** Downloads a published dataset as raw text (CSV for the ones we consume). */
export async function fetchDatasetFile(datasetId: string): Promise<string> {
  const url = `${env.mefApiBase}/public-datasets/${datasetId}/file`;
  const response = await fetchWithTimeout(url, { accept: '*/*' });
  if (!response.ok) {
    throw upstreamUnavailable(`Dataset ${datasetId} returned ${response.status}`);
  }
  return response.text();
}

export interface DatasetMetadata {
  id: string;
  name: string;
  description: string | null;
  format: string | null;
  frequency: string | null;
  coverage_start: string | null;
  coverage_end: string | null;
  updated_at: string | null;
  organization?: { abbreviation: string | null; name_en: string | null } | null;
}

export async function fetchDatasetMetadata(datasetId: string): Promise<DatasetMetadata> {
  const body = await getJson<{ data: DatasetMetadata }>(`/public-datasets/${datasetId}`);
  return body.data;
}

export function datasetPageUrl(datasetId: string): string {
  return `https://data.mef.gov.kh/datasets/${datasetId}`;
}
