export interface IngestResult {
  rowsRead: number;
  rowsWritten: number;
  rowsSkipped: number;
  detail?: Record<string, unknown>;
  /** Non-fatal problems worth surfacing on the data-health page. */
  warnings?: string[];
}

export interface Adapter {
  /** Stable key used on the CLI, in the scheduler and in ingestion_runs. */
  key: string;
  sourceCode: string;
  title: string;
  run: () => Promise<IngestResult>;
}
