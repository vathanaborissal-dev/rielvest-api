import { fetch } from 'undici';

/**
 * Live sources that are read through, never stored.
 *
 * CSX closes at 15:00 and reopens at 09:00 the next weekday. Everything that
 * moves in between happens somewhere else — regional indices, gold, the dollar,
 * and whatever the local press reported overnight. That context is what a
 * trader checks before entering a pre-opening order, and none of it belongs in
 * RielVest's database: it is someone else's data, it goes stale in minutes, and
 * persisting it would blur the line between what this product measured and what
 * it borrowed.
 *
 * Every fetcher here resolves rather than throws. A source being down must
 * degrade to "unavailable" on one row, never take out the page.
 */

const USER_AGENT = 'RielVest/1.0 (+https://rielvest-ui.vercel.app)';
const TIMEOUT_MS = 6_000;

/**
 * How old the newest close may be before the figure is refused.
 *
 * The dangerous upstream failure is not an error — it is a plausible number
 * from months ago. Yahoo's daily series for ^SET.BK stops in mid-July while its
 * own metadata reports a September session, so a naive read would have
 * published a two-month-old move as today's. Five days covers a weekend plus a
 * public holiday without admitting anything genuinely stale.
 */
const MAX_STALENESS_DAYS = 5;

export interface LiveQuote {
  key: string;
  label: string;
  /** A clarification about what the figure is. Not the same as being a proxy. */
  note: string | null;
  /**
   * True only when the symbol stands in for something it is not. A note
   * explaining that gold is a futures price is a clarification; an ETF standing
   * in for an index a reader asked about is a substitution, and only the second
   * deserves a badge.
   */
  isProxy: boolean;
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  currency: string | null;
  /** Exchange-local date of the last close used. */
  asOf: string | null;
  available: boolean;
  unavailableReason: string | null;
}

export interface LiveHeadline {
  title: string;
  url: string;
  publishedAt: string | null;
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * One instrument from Yahoo's chart endpoint.
 *
 * The change is computed from the **last two daily closes in the series**, not
 * from `meta.chartPreviousClose`. Over a five-day range that field holds the
 * close before the window opens, so using it reports a five-session move as if
 * it were one session — on Hang Seng that was -3.3% against an actual -0.6%.
 */
export async function fetchYahooQuote(
  symbol: string,
  label: string,
  note: string | null = null,
  key = label,
  isProxy = false,
): Promise<LiveQuote> {
  const base: LiveQuote = {
    key,
    label,
    note,
    isProxy,
    price: null,
    previousClose: null,
    changePercent: null,
    currency: null,
    asOf: null,
    available: false,
    unavailableReason: null,
  };

  try {
    const raw = await getText(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`,
    );
    const parsed = JSON.parse(raw) as {
      chart: {
        error: { description?: string } | null;
        result?: Array<{
          meta: { currency?: string };
          timestamp?: number[];
          indicators: { quote: Array<{ close?: (number | null)[] }> };
        }>;
      };
    };

    if (parsed.chart.error) {
      return { ...base, unavailableReason: parsed.chart.error.description ?? 'Upstream rejected the symbol.' };
    }

    const result = parsed.chart.result?.[0];
    const closes = result?.indicators.quote[0]?.close ?? [];
    const stamps = result?.timestamp ?? [];

    // Keep close/timestamp pairs together so a gap in one does not shift the other.
    const points = closes
      .map((close, index) => ({ close, at: stamps[index] }))
      .filter((point): point is { close: number; at: number } =>
        typeof point.close === 'number' && Number.isFinite(point.close) && typeof point.at === 'number');

    if (points.length < 2) {
      return {
        ...base,
        unavailableReason: 'The source returned fewer than two sessions, so no change can be computed.',
      };
    }

    const last = points.at(-1)!;
    const previous = points.at(-2)!;

    const lastDate = new Date(last.at * 1_000);
    const ageDays = (Date.now() - lastDate.getTime()) / 86_400_000;
    if (ageDays > MAX_STALENESS_DAYS) {
      return {
        ...base,
        unavailableReason:
          `The source's most recent close is ${lastDate.toISOString().slice(0, 10)}, ` +
          `${Math.floor(ageDays)} days old — too stale to report as a current move.`,
      };
    }

    return {
      ...base,
      price: last.close,
      previousClose: previous.close,
      changePercent: previous.close === 0 ? null : (last.close / previous.close - 1) * 100,
      currency: result?.meta.currency ?? null,
      asOf: new Date(last.at * 1_000).toISOString().slice(0, 10),
      available: true,
    };
  } catch (error) {
    return {
      ...base,
      unavailableReason: error instanceof Error ? error.message : 'The source could not be reached.',
    };
  }
}

/** Cambodian business headlines. Titles and links only — no article text. */
export async function fetchKhmerBusinessHeadlines(limit = 6): Promise<LiveHeadline[]> {
  try {
    const xml = await getText('https://www.khmertimeskh.com/category/business/feed/');
    const items = xml.split('<item>').slice(1, limit + 1);

    return items
      .map((item) => {
        const title = pick(item, 'title');
        const url = pick(item, 'link');
        const published = pick(item, 'pubDate');
        if (!title || !url) return null;
        const at = published ? Date.parse(published) : Number.NaN;
        return {
          title,
          url,
          publishedAt: Number.isNaN(at) ? null : new Date(at).toISOString(),
        } satisfies LiveHeadline;
      })
      .filter((item): item is LiveHeadline => item !== null);
  } catch {
    return [];
  }
}

/** First value of an RSS tag, with CDATA and entities unwrapped. */
function pick(item: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(item);
  if (!match) return null;
  return decodeEntities(
    (match[1] ?? '')
      .replace(/^\s*<!\[CDATA\[/, '')
      .replace(/\]\]>\s*$/, '')
      .trim(),
  );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8230;/g, '…')
    .replace(/&amp;/g, '&');
}
