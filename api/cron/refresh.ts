import type { Request, Response } from 'express';
import { logger } from '../../src/core/logger.ts';
import { disconnectPrisma } from '../../src/core/prisma.ts';
import { runDaily } from '../../src/ingest/runner.ts';

const log = logger('cron');

/**
 * The daily market refresh, as a scheduled serverless invocation.
 *
 * On a long-running host an interval timer does this (see
 * `src/ingest/scheduler.ts`). Serverless has no process to hold a timer, so
 * Vercel Cron calls this endpoint instead — the schedule lives in
 * `vercel.json`. Without it the API would keep serving happily while the data
 * silently stopped moving, which is the worst failure this product can have.
 *
 * Vercel signs scheduled requests with `Authorization: Bearer $CRON_SECRET`.
 * The check is mandatory: the route triggers outbound fetches and database
 * writes, so an open endpoint is an invitation to run them.
 */
export default async function handler(req: Request, res: Response): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(500).json({
      error: {
        code: 'not_configured',
        message: 'CRON_SECRET is not set, so scheduled refreshes cannot be authenticated.',
      },
    });
    return;
  }

  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid cron credentials.' } });
    return;
  }

  const startedAt = Date.now();
  try {
    const outcomes = await runDaily('schedule');
    const failed = outcomes.filter((outcome) => outcome.status === 'failed');

    log.info(`refresh complete — ${outcomes.map((o) => `${o.key}:${o.status}`).join(' ')}`);

    // 207 when some adapters failed: the refresh partly succeeded, and a plain
    // 200 would hide that from Vercel's cron log.
    res.status(failed.length > 0 ? 207 : 200).json({
      ok: failed.length === 0,
      durationMs: Date.now() - startedAt,
      outcomes: outcomes.map((outcome) => ({
        adapter: outcome.key,
        status: outcome.status,
        rowsRead: outcome.rowsRead,
        rowsWritten: outcome.rowsWritten,
        warnings: outcome.warnings,
        error: outcome.error,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('refresh failed', message);
    res.status(500).json({ ok: false, error: message });
  } finally {
    // Serverless containers freeze between invocations; releasing the pool
    // stops idle Postgres connections accumulating against Supabase's limit.
    await disconnectPrisma().catch(() => undefined);
  }
}
