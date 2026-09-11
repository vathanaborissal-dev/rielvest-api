import { env } from '../config/env.ts';
import { upstreamUnavailable } from '../core/errors.ts';
import { portalFetch } from './httpAgent.ts';
import type { DatasetMetadata } from './mefClient.ts';

interface SearchResponse {
  total_items: number;
  total_pages: number;
  page: number;
  data: DatasetMetadata[];
}

/**
 * Finds published datasets whose title contains any of the given phrases.
 *
 * The portal's keyword search is fuzzy and returns loosely related datasets, so
 * results are filtered again on the title. Discovering by title rather than by
 * hard-coded id means next quarter's publication is imported without a code
 * change.
 */
export async function discoverDatasets(phrases: string[]): Promise<DatasetMetadata[]> {
  const found = new Map<string, DatasetMetadata>();

  for (const phrase of phrases) {
    const url = `${env.mefApiBase}/public-datasets?page_size=100&keyword=${encodeURIComponent(phrase)}`;
    const response = await portalFetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'RielVest/1.0' },
      signal: AbortSignal.timeout(30_000),
    }).catch((error: unknown) => {
      throw upstreamUnavailable('Could not search the Cambodian open-data portal', {
        cause: error instanceof Error ? error.message : String(error),
      });
    });

    if (!response.ok) {
      throw upstreamUnavailable(`Dataset search returned ${response.status}`);
    }

    const body = (await response.json()) as SearchResponse;
    const needle = phrase.toLowerCase();
    for (const dataset of body.data ?? []) {
      // Titles occasionally carry zero-width joiners between words.
      const title = dataset.name.replace(/[​-‍﻿]/g, '').toLowerCase();
      if (title.includes(needle) && !found.has(dataset.id)) {
        found.set(dataset.id, dataset);
      }
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
