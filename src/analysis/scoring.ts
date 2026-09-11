import { clamp } from '../core/num.ts';
import type { Assessment, Metric } from './types.ts';

/**
 * A deliberately simple, inspectable scoring scheme.
 *
 * There is no opaque model here. Each scored metric is mapped onto 0-100 by a
 * band table that is returned alongside the score, so a reader can see exactly
 * which threshold their number fell into and disagree with it if they like.
 * Category scores are the plain mean of the metrics that could be scored;
 * metrics with no data are excluded rather than counted as zero, because
 * "unknown" is not "bad".
 */

export interface Band {
  label: string;
  /** Inclusive lower bound; null means unbounded. */
  from: number | null;
  /** Exclusive upper bound; null means unbounded. */
  to: number | null;
  score: number;
  assessment: Assessment;
}

export interface BandResult {
  score: number;
  assessment: Assessment;
  matched: Band | null;
}

export function scoreWithBands(value: number | null, bands: Band[]): BandResult {
  if (value === null) return { score: 0, assessment: 'insufficient_data', matched: null };
  const matched =
    bands.find(
      (band) => (band.from === null || value >= band.from) && (band.to === null || value < band.to),
    ) ?? null;
  if (!matched) return { score: 0, assessment: 'insufficient_data', matched: null };
  return { score: clamp(matched.score, 0, 100), assessment: matched.assessment, matched };
}

export const toScale = (bands: Band[]) =>
  bands.map((band) => ({ label: band.label, from: band.from, to: band.to }));

/** Mean of the metrics that carry a score; null when none do. */
export function averageScore(metrics: Metric[]): number | null {
  const scored = metrics.filter(
    (metric): metric is Metric & { score: number } =>
      typeof metric.score === 'number' && metric.assessment !== 'insufficient_data',
  );
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((total, metric) => total + metric.score, 0) / scored.length);
}

/** Turns a 0-100 score into the same vocabulary the metrics use. */
export function assessmentForScore(score: number | null): Assessment {
  if (score === null) return 'insufficient_data';
  if (score >= 70) return 'positive';
  if (score >= 50) return 'neutral';
  if (score >= 30) return 'caution';
  return 'risk';
}

export const METHODOLOGY = [
  'Each metric is placed into a published band that maps it to a 0-100 score.',
  'A category score is the plain average of the metrics inside it that could be scored.',
  'Metrics with no reliable data are excluded from the average rather than scored zero — RielVest',
  'treats "unknown" as unknown, not as bad news.',
  'The overall score is the average of the category scores that could be formed, and "coverage"',
  'reports what share of the intended analysis the available Cambodian data actually supported.',
  'Scores describe what the current data shows. They are not forecasts, and they are not advice.',
].join(' ');
