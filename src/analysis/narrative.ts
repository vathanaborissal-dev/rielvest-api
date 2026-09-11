import { round } from '../core/num.ts';
import { latestQuote, type AnalysisInput } from './inputs.ts';
import type { Category, Finding } from './types.ts';

/**
 * Turns computed findings into plain sentences.
 *
 * Every clause below is generated from a number that already exists in the
 * analysis. Nothing is inferred, and nothing predicts what a price will do —
 * the vocabulary stays descriptive: positive, neutral, caution, risk,
 * improving, deteriorating.
 *
 * This is the seam where a language model could later be substituted: it takes
 * a structured analysis and returns sentences, so swapping the implementation
 * changes nothing else in the product.
 */
export function buildNarrative(
  input: AnalysisInput,
  categories: Category[],
  risks: Finding[],
  opportunities: Finding[],
): string[] {
  const lines: string[] = [];
  const quote = latestQuote(input);

  // 1. What the shares did most recently.
  if (quote) {
    const direction =
      quote.change === null || quote.change === 0
        ? 'was unchanged'
        : quote.change > 0
          ? `rose ${round(quote.change, 0)} riel`
          : `fell ${round(Math.abs(quote.change), 0)} riel`;
    lines.push(
      `${input.name} (${input.symbol}) closed at ${round(quote.close, 0).toLocaleString('en-US')} riel on ${quote.tradeDate}, where it ${direction} on the session.`,
    );
  }

  // 2. How it is valued, in the market's own terms.
  const valuation = categories.find((category) => category.key === 'valuation');
  const pe = valuation?.metrics.find((metric) => metric.key === 'pe')?.value ?? null;
  const pb = valuation?.metrics.find((metric) => metric.key === 'pb')?.value ?? null;
  if (pe !== null && pb !== null) {
    lines.push(
      `It trades on ${round(pe, 1)} times earnings and ${round(pb, 2)} times book value, both as published by CSX.`,
    );
  } else if (pb !== null) {
    lines.push(
      `CSX publishes no P/E for the company — it does that when there are no positive earnings to divide by — but the shares trade at ${round(pb, 2)} times book value.`,
    );
  }

  // 3. What it earns on shareholder capital.
  const roe =
    categories
      .find((category) => category.key === 'financial_health')
      ?.metrics.find((metric) => metric.key === 'roe')?.value ?? null;
  if (roe !== null) {
    const quality = roe >= 15 ? 'a strong return' : roe >= 8 ? 'a reasonable return' : 'a modest return';
    lines.push(
      `Rearranging those two ratios gives a return on equity of about ${round(roe, 1)}%, ${quality} on the capital shareholders have in the business.`,
    );
  }

  // 4. The single most important risk, stated concretely.
  const leadRisk = risks[0];
  if (leadRisk) lines.push(leadRisk.statement);

  const leadOpportunity = opportunities[0];
  if (leadOpportunity && leadOpportunity.statement !== leadRisk?.statement) {
    lines.push(leadOpportunity.statement);
  }

  // 5. Be explicit about what is missing, every time.
  const gaps = categories.flatMap((category) => category.dataGaps);
  if (gaps.length > 0) {
    const missing: string[] = [];
    if (input.financials.length === 0) missing.push('filed financial statements');
    if (input.dividends.length === 0) missing.push('dividend history');
    if (input.quotes.length < 10) missing.push('a long enough price history to measure volatility');
    if (missing.length > 0) {
      lines.push(
        `This assessment works with what Cambodia publishes: ${formatList(missing)} ${missing.length === 1 ? 'is' : 'are'} not available for CSX issuers, so anything depending on ${missing.length === 1 ? 'it' : 'them'} is left unassessed rather than estimated.`,
      );
    }
  }

  return lines;
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
