/**
 * The narrative provider contract.
 *
 * Deliberately tiny, and deliberately not Gemini-shaped: the model is asked for
 * prose given a payload, nothing more. Swapping Gemini for Claude — or dropping
 * AI entirely — should touch this file's implementations and nothing else.
 */
export interface NarrativeRequest {
  /** Operator instruction; identical for every call so it can be cached. */
  system: string;
  /** The structured analysis the model may describe, and nothing beyond it. */
  payload: unknown;
  /** What to produce from it. */
  instruction: string;
  language: 'en' | 'km';
}

export interface NarrativeResponse {
  /** One short paragraph per element. */
  lines: string[];
  model: string;
}

export interface NarrativeProvider {
  readonly name: string;
  readonly model: string;
  generate(request: NarrativeRequest): Promise<NarrativeResponse>;
}
