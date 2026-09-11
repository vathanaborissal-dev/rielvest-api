import { logger } from '../core/logger.ts';
import { round } from '../core/num.ts';
import type { StockAnalysis } from '../analysis/types.ts';
import { createGeminiProvider } from './gemini.ts';
import { guardNumbers } from './numberGuard.ts';
import type { NarrativeProvider } from './types.ts';

const log = logger('ai:narrator');

/**
 * Turns a computed analysis into readable sentences.
 *
 * The division of labour is the whole point: the analysis engine decides what
 * is true, and the model only decides how to say it. The model receives a
 * trimmed view of the analysis and is told, in the system instruction and again
 * by the guard, that it may not introduce a figure. Whatever it returns is
 * checked against that payload before anyone sees it.
 *
 * Every failure path ends in the deterministic sentences the engine already
 * produces, so switching the model off — or having it fail, rate-limit, or
 * hallucinate — degrades the wording and nothing else.
 */

const SYSTEM_INSTRUCTION = [
  'You write short, plain explanations of Cambodian stock market data for retail investors.',
  '',
  'Absolute rules:',
  '1. Use ONLY figures present in the JSON you are given. Never calculate a new one,',
  '   never estimate, never recall a figure from elsewhere. If a number is not in the',
  '   JSON, it may not appear in your answer.',
  '2. Never predict a price or say whether to buy, sell or hold. Describe what the data',
  '   shows and what it does not.',
  '3. If the data is thin or missing, say so plainly. "Not reported" is a useful answer.',
  '4. No hedging filler, no marketing language, no exclamation marks.',
  '',
  'Style: short sentences. One idea each. Write for someone who is not a financial',
  'professional but is about to risk their own money.',
].join('\n');

const INSTRUCTIONS: Record<'en' | 'km', string> = {
  en: 'Write 2 to 4 sentences in English summarising this stock for someone deciding whether to look closer.',
  km: 'Write 2 to 4 sentences in Khmer (ភាសាខ្មែរ) summarising this stock for someone deciding whether to look closer. Keep ticker symbols and numerals in Latin script.',
};

/**
 * The slice of the analysis the model is allowed to see.
 *
 * Trimmed deliberately: a smaller payload is cheaper, easier for the model to
 * stay inside, and — because the guard's allowed-number set is built from
 * exactly this object — narrows what can be said at all.
 */
export function toNarrativePayload(analysis: StockAnalysis) {
  return {
    symbol: analysis.symbol,
    name: analysis.name,
    asOf: analysis.asOf,
    overallScore: analysis.score,
    assessment: analysis.assessment,
    coveragePercent: analysis.coverage,
    categories: analysis.categories.map((category) => ({
      name: category.label,
      score: category.score,
      assessment: category.assessment,
      metrics: category.metrics
        .filter((metric) => metric.value !== null)
        .map((metric) => ({
          name: metric.label,
          value: typeof metric.value === 'number' ? round(metric.value, 4) : metric.value,
          unit: metric.unit,
          provenance: metric.provenance,
        })),
    })),
    risks: analysis.risks.map((finding) => finding.statement),
    opportunities: analysis.opportunities.map((finding) => finding.statement),
    whatIsMissing: analysis.dataGaps,
  };
}

export interface NarrativeResult {
  lines: string[];
  /** 'model' when the AI passed the guard, 'engine' for the template. */
  source: 'model' | 'engine';
  model?: string;
  /** Why the model's output was not used, when it was not. */
  fallbackReason?: string;
}

let provider: NarrativeProvider | null | undefined;

function getProvider(): NarrativeProvider | null {
  if (provider === undefined) provider = createGeminiProvider();
  return provider;
}

export function isNarrativeEnabled(): boolean {
  return getProvider() !== null;
}

/**
 * Produces a narrative, falling back to `engineLines` whenever the model
 * cannot be trusted or reached.
 */
export async function narrate(
  analysis: StockAnalysis,
  engineLines: string[],
  language: 'en' | 'km' = 'en',
): Promise<NarrativeResult> {
  const active = getProvider();
  if (!active) return { lines: engineLines, source: 'engine', fallbackReason: 'no provider configured' };

  const payload = toNarrativePayload(analysis);

  try {
    const response = await active.generate({
      system: SYSTEM_INSTRUCTION,
      payload,
      instruction: INSTRUCTIONS[language],
      language,
    });

    if (response.lines.length === 0) {
      return { lines: engineLines, source: 'engine', fallbackReason: 'model returned nothing' };
    }

    // The guard runs against the same object the model was shown, so anything
    // it could legitimately mention is in the allowed set by construction.
    const verdict = guardNumbers(response.lines.join(' '), payload);
    if (!verdict.ok) {
      log.warn(
        `${analysis.symbol}: discarding model output, ${verdict.unsupported.length} unsourced figure(s)`,
        verdict.unsupported,
      );
      return {
        lines: engineLines,
        source: 'engine',
        fallbackReason: `unsourced figures: ${verdict.unsupported.join(', ')}`,
      };
    }

    return { lines: response.lines, source: 'model', model: response.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`${analysis.symbol}: narrative unavailable, using engine text`, message);
    return { lines: engineLines, source: 'engine', fallbackReason: message };
  }
}
