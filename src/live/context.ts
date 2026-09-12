import { cached } from './cache.ts';
import { fetchKhmerBusinessHeadlines, fetchYahooQuote, type LiveHeadline, type LiveQuote } from './sources.ts';

/**
 * What moved while Phnom Penh was shut.
 *
 * CSX trades 09:00–15:00 and is closed for eighteen hours out of every
 * twenty-four. Nothing in RielVest's database says anything about that gap, yet
 * it is exactly the window a pre-opening order is priced across. This assembles
 * the outside context a trader checks at 08:00 — regional markets, gold, the
 * dollar, and what the local press reported overnight.
 *
 * None of it is stored. Each response is held in memory briefly and refetched
 * after that; a cold start simply asks again. The figures belong to their
 * sources and are labelled as such.
 */

/** Regional exchanges whose sessions overlap or precede Cambodia's. */
const INSTRUMENTS: Array<{ symbol: string; label: string; note: string | null; key: string; isProxy?: boolean }> = [
  { key: 'set', symbol: '^SET.BK', label: 'Thailand SET', note: null },
  { key: 'jkse', symbol: '^JKSE', label: 'Indonesia JCI', note: null },
  { key: 'klse', symbol: '^KLSE', label: 'Malaysia KLCI', note: null },
  { key: 'sti', symbol: '^STI', label: 'Singapore STI', note: null },
  { key: 'hsi', symbol: '^HSI', label: 'Hong Kong HSI', note: null },
  { key: 'n225', symbol: '^N225', label: 'Japan Nikkei 225', note: null },
  {
    key: 'vietnam',
    symbol: 'VNM',
    label: 'Vietnam (VNM ETF)',
    isProxy: true,
    // Named honestly: Yahoo does not serve the VN-Index, and a US-listed ETF
    // tracks it loosely and trades in a different session and currency.
    note: 'A US-listed ETF, not the VN-Index itself — it trades in New York hours and in dollars.',
  },
];

const BENCHMARKS: Array<{ symbol: string; label: string; note: string | null; key: string; isProxy?: boolean }> = [
  { key: 'gold', symbol: 'GC=F', label: 'Gold', note: 'COMEX front-month futures, USD per troy ounce.' },
  { key: 'usdkhr', symbol: 'USDKHR=X', label: 'USD / KHR', note: 'Market rate, not the National Bank reference rate.' },
];

export interface MarketContext {
  fetchedAt: string;
  /** Regional equity markets, nearest neighbours first. */
  region: LiveQuote[];
  /** Gold and the dollar, which Cambodian savers hold as alternatives. */
  benchmarks: LiveQuote[];
  headlines: LiveHeadline[];
  /** One sentence on the region, or null when too little came back. */
  summary: string | null;
  sources: Array<{ label: string; url: string; note: string }>;
  /** Stated on the page: this data is borrowed and not retained. */
  storage: string;
}

const QUOTE_TTL_SECONDS = 120;
const NEWS_TTL_SECONDS = 600;

export async function getMarketContext(): Promise<MarketContext> {
  return cached('market-context', QUOTE_TTL_SECONDS, async () => {
    // One slow source must not serialise the rest; each already resolves on
    // failure, so nothing here can reject.
    const [region, benchmarks, headlines] = await Promise.all([
      Promise.all(INSTRUMENTS.map((i) => fetchYahooQuote(i.symbol, i.label, i.note, i.key, i.isProxy ?? false))),
      Promise.all(BENCHMARKS.map((i) => fetchYahooQuote(i.symbol, i.label, i.note, i.key, i.isProxy ?? false))),
      cached('khmer-headlines', NEWS_TTL_SECONDS, () => fetchKhmerBusinessHeadlines(6)),
    ]);

    return {
      fetchedAt: new Date().toISOString(),
      region,
      benchmarks,
      headlines,
      summary: summarise(region),
      sources: [
        {
          label: 'Yahoo Finance',
          url: 'https://finance.yahoo.com',
          note: 'Regional indices, gold and FX. Read live on each request and not stored.',
        },
        {
          label: 'Khmer Times — Business',
          url: 'https://www.khmertimeskh.com/category/business/',
          note: 'Headlines and links only. No article text is copied or retained.',
        },
      ],
      storage:
        'Nothing on this panel is written to RielVest’s database. It is read from the ' +
        'sources listed above when you open the page and discarded afterwards, so it ' +
        'carries their accuracy and their delays, not RielVest’s.',
    };
  });
}

/**
 * Counts the region rather than averaging it.
 *
 * These indices are in different currencies and are weighted differently, so a
 * mean of their percentage moves would be a number with no referent. How many
 * closed higher is a fact; "the region fell 1.4%" would not be.
 */
function summarise(region: LiveQuote[]): string | null {
  const known = region.filter((quote) => quote.available && quote.changePercent !== null);
  if (known.length < 3) return null;

  const up = known.filter((quote) => quote.changePercent! > 0);
  const down = known.filter((quote) => quote.changePercent! < 0);

  const extreme = [...known].sort(
    (a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!),
  )[0]!;
  const move = `${extreme.label} ${extreme.changePercent! >= 0 ? 'up' : 'down'} ${Math.abs(
    extreme.changePercent!,
  ).toFixed(1)}%`;

  if (down.length === 0) return `All ${known.length} regional markets closed higher — ${move}.`;
  if (up.length === 0) return `All ${known.length} regional markets closed lower — ${move}.`;
  return `${up.length} of ${known.length} regional markets closed higher. Biggest move: ${move}.`;
}
