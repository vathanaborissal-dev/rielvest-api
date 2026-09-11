import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.ts';
import { upstreamUnavailable } from '../core/errors.ts';
import type { NarrativeProvider, NarrativeRequest, NarrativeResponse } from './types.ts';

/**
 * Gemini, via Google AI Studio's free tier.
 *
 * Structured output is requested rather than free prose so the response is a
 * JSON array of lines: a model that is already constrained to a schema is less
 * inclined to editorialise, and the caller never has to parse paragraphs out of
 * markdown.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      description: 'Two to four short sentences, each a complete thought.',
      items: { type: 'string' },
    },
  },
  required: ['lines'],
} as const;

export function createGeminiProvider(): NarrativeProvider | null {
  if (!env.geminiApiKey) return null;

  const client = new GoogleGenAI({ apiKey: env.geminiApiKey });

  return {
    name: 'google-ai-studio',
    model: env.geminiModel,

    async generate(request: NarrativeRequest): Promise<NarrativeResponse> {
      const input = [
        request.instruction,
        '',
        'Data you may describe (JSON). Use nothing outside it:',
        JSON.stringify(request.payload),
      ].join('\n');

      let interaction;
      try {
        interaction = await client.interactions.create({
          model: env.geminiModel,
          input,
          system_instruction: request.system,
          generation_config: {
            max_output_tokens: 700,
            // This is a rewriting task with a right answer, not a creative
            // one: minimal reasoning is enough and keeps it inside the free
            // tier, and a fixed seed makes the same session produce the same
            // sentences — which is what makes caching them honest.
            thinking_level: 'minimal',
            seed: 7,
          },
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: RESPONSE_SCHEMA,
          },
        });
      } catch (error) {
        throw upstreamUnavailable('The narrative model could not be reached.', {
          cause: error instanceof Error ? error.message : String(error),
        });
      }

      const raw = interaction.output_text;
      if (!raw) throw upstreamUnavailable('The narrative model returned an empty response.');

      let parsed: { lines?: unknown };
      try {
        parsed = JSON.parse(raw) as { lines?: unknown };
      } catch {
        throw upstreamUnavailable('The narrative model returned malformed JSON.');
      }

      const lines = Array.isArray(parsed.lines)
        ? parsed.lines.filter((line): line is string => typeof line === 'string' && line.trim() !== '')
        : [];

      return { lines: lines.map((line) => line.trim()), model: env.geminiModel };
    },
  };
}
