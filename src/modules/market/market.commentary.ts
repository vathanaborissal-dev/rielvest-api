import { pctChange, round } from '../../core/num.ts';
import type { Assessment } from '../../analysis/types.ts';
import type { CommentaryPoint, MarketCommentary } from './market.types.ts';
import type { MarketSnapshot } from './market.service.ts';

/**
 * "Market Today" — a reading of the session, generated from the session.
 *
 * Every sentence below is produced from a number in the snapshot, and each is
 * tagged so the interface can keep three things visually distinct:
 *
 *   `data`           an observation straight from the exchange
 *   `interpretation` RielVest's reading of those observations
 *   `gap`            something the data cannot answer
 *
 * The vocabulary stays descriptive. Nothing here forecasts a price.
 */

const formatKhr = (value: number): string => {
  if (Math.abs(value) >= 1_000_000_000) return `${round(value / 1_000_000_000, 1)} billion riel`;
  if (Math.abs(value) >= 1_000_000) return `${round(value / 1_000_000, 0)} million riel`;
  return `${round(value, 0).toLocaleString('en-US')} riel`;
};

export interface CommentaryInput {
  snapshot: MarketSnapshot;
  previousSessionValue: number | null;
  previousSessionDate: string | null;
  medianPe: number | null;
}

export function buildMarketCommentary(input: CommentaryInput): MarketCommentary {
  const { snapshot } = input;
  const points: CommentaryPoint[] = [];

  if (!snapshot.tradeDate || snapshot.quotes.length === 0) {
    return {
      headline: 'No trading session has been recorded yet.',
      sentiment: 'insufficient_data',
      points: [
        {
          statement:
            'RielVest records the official CSX summary once per trading day. Nothing has been captured yet, so there is nothing to interpret.',
          assessment: 'insufficient_data',
          kind: 'gap',
        },
      ],
      asOf: null,
      method: METHOD,
    };
  }

  const { breadth, index } = snapshot;

  // --- Observations ---------------------------------------------------------

  if (index) {
    const direction =
      index.changePercent === null || index.changePercent === 0
        ? 'finished unchanged'
        : index.changePercent > 0
          ? `rose ${round(index.changePercent, 2)}%`
          : `fell ${round(Math.abs(index.changePercent), 2)}%`;
    points.push({
      statement: `The CSX index ${direction} to ${round(index.value, 2)}${index.open !== null ? `, having opened at ${round(index.open, 2)}` : ''}.`,
      assessment: 'neutral',
      kind: 'data',
    });
  }

  points.push({
    statement: `${breadth.advancing} of ${breadth.total} listed stocks rose, ${breadth.declining} fell and ${breadth.unchanged} closed unchanged.`,
    assessment: 'neutral',
    kind: 'data',
  });

  points.push({
    statement: `${formatKhr(snapshot.totalValue)} changed hands across ${snapshot.totalVolume.toLocaleString('en-US')} shares.`,
    assessment: 'neutral',
    kind: 'data',
  });

  // --- Interpretation -------------------------------------------------------

  const sentiment = readSentiment(breadth, index?.changePercent ?? null);
  points.push({
    statement: describeSentiment(sentiment, breadth, index?.changePercent ?? null),
    assessment: sentiment,
    kind: 'interpretation',
  });

  const turnoverChange =
    input.previousSessionValue !== null && input.previousSessionValue > 0
      ? pctChange(input.previousSessionValue, snapshot.totalValue)
      : null;
  if (turnoverChange !== null && Math.abs(turnoverChange) >= 15) {
    points.push({
      statement:
        turnoverChange > 0
          ? `Trading activity picked up markedly — turnover was ${round(turnoverChange, 0)}% higher than on ${input.previousSessionDate}, which usually means conviction behind the day's moves.`
          : `Trading activity was subdued — turnover fell ${round(Math.abs(turnoverChange), 0)}% against ${input.previousSessionDate}, so the day's price moves rest on thinner volume.`,
      assessment: turnoverChange > 0 ? 'neutral' : 'caution',
      kind: 'interpretation',
    });
  }

  // Concentration matters a great deal on an exchange with eleven issuers: one
  // stock carrying most of the turnover means the headline masks a quiet market.
  const leader = [...snapshot.quotes].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  if (leader && snapshot.totalValue > 0 && leader.value !== null) {
    const share = (leader.value / snapshot.totalValue) * 100;
    if (share >= 50) {
      points.push({
        statement: `${leader.symbol} alone accounted for ${round(share, 0)}% of the day's turnover, so market-wide activity figures largely describe that one stock.`,
        assessment: 'caution',
        kind: 'interpretation',
      });
    }
  }

  // Anything moving on unusual volume is worth a reader's attention.
  const notable = snapshot.quotes
    .filter((quote) => Math.abs(quote.changePercent ?? 0) >= 3 && (quote.volume ?? 0) > 0)
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
    .slice(0, 2);
  for (const quote of notable) {
    points.push({
      statement: `${quote.symbol} stands out, ${quote.changePercent! > 0 ? 'up' : 'down'} ${round(Math.abs(quote.changePercent!), 1)}% on ${quote.volume!.toLocaleString('en-US')} shares.`,
      assessment: quote.changePercent! > 0 ? 'improving' : 'caution',
      kind: 'interpretation',
    });
  }

  const untraded = snapshot.quotes.filter((quote) => (quote.volume ?? 0) === 0);
  if (untraded.length > 0) {
    points.push({
      statement: `${untraded.length} listed stock${untraded.length === 1 ? '' : 's'} did not trade at all (${untraded.map((quote) => quote.symbol).join(', ')}), a standing feature of a market this size.`,
      assessment: 'caution',
      kind: 'interpretation',
    });
  }

  // --- What today's data cannot tell you ------------------------------------

  if (snapshot.quotedCount < snapshot.listedCount) {
    points.push({
      statement: `${snapshot.listedCount - snapshot.quotedCount} listed company is in RielVest's register but absent from the exchange's daily feed, so it carries no price here.`,
      assessment: 'insufficient_data',
      kind: 'gap',
    });
  }

  return {
    headline: headlineFor(sentiment),
    sentiment,
    points,
    asOf: snapshot.tradeDate,
    method: METHOD,
  };
}

/**
 * Sentiment from breadth and the index together.
 *
 * Breadth alone misleads on a market where one large issuer can carry the
 * index, so both must agree before the reading moves off neutral.
 */
function readSentiment(
  breadth: { advancing: number; declining: number; total: number },
  indexChangePct: number | null,
): Assessment {
  const traded = breadth.advancing + breadth.declining;
  const advanceShare = traded > 0 ? breadth.advancing / traded : 0.5;
  const indexUp = indexChangePct === null ? 0 : Math.sign(indexChangePct);

  if (advanceShare >= 0.7 && indexUp > 0) return 'positive';
  if (advanceShare <= 0.3 && indexUp < 0) return 'risk';
  if (advanceShare >= 0.6 || indexUp > 0) return 'improving';
  if (advanceShare <= 0.4 || indexUp < 0) return 'caution';
  return 'neutral';
}

function headlineFor(sentiment: Assessment): string {
  switch (sentiment) {
    case 'positive':
      return 'Market sentiment appears broadly positive.';
    case 'improving':
      return 'Market sentiment appears moderately positive.';
    case 'caution':
      return 'Market sentiment appears moderately negative.';
    case 'risk':
      return 'Market sentiment appears broadly negative.';
    default:
      return 'Market sentiment appears mixed.';
  }
}

function describeSentiment(
  sentiment: Assessment,
  breadth: { advancing: number; declining: number },
  indexChangePct: number | null,
): string {
  const indexClause =
    indexChangePct === null
      ? 'the index was unchanged'
      : indexChangePct > 0
        ? `the index gained ${round(indexChangePct, 2)}%`
        : indexChangePct < 0
          ? `the index lost ${round(Math.abs(indexChangePct), 2)}%`
          : 'the index was flat';

  switch (sentiment) {
    case 'positive':
      return `Advances outnumbered declines ${breadth.advancing} to ${breadth.declining} and ${indexClause}, so buyers had the better of the session across most of the board.`;
    case 'improving':
      return `Advances led declines ${breadth.advancing} to ${breadth.declining} and ${indexClause} — a firm session, though not a uniform one.`;
    case 'caution':
      return `Declines led advances ${breadth.declining} to ${breadth.advancing} and ${indexClause}, leaving the tone on the softer side.`;
    case 'risk':
      return `Declines outnumbered advances ${breadth.declining} to ${breadth.advancing} and ${indexClause}, a broadly weak session.`;
    default:
      return `Advances and declines were close to balanced (${breadth.advancing} against ${breadth.declining}) and ${indexClause}, giving no clear direction.`;
  }
}

const METHOD =
  'Generated from the session RielVest recorded — index level and change, advance/decline counts, ' +
  'traded volume and value, and each stock\'s own move. Observations are labelled separately from ' +
  'RielVest\'s reading of them. No external commentary or forecast is used.';
