import { env } from '../config/env.ts';
import { logger } from '../core/logger.ts';
import { prisma } from '../core/prisma.ts';
import { runDaily } from './runner.ts';

const log = logger('scheduler');

let timer: NodeJS.Timeout | undefined;

/**
 * Refreshes the daily feeds on a fixed interval.
 *
 * CSX publishes once per session, so polling hourly is ample; the upsert makes
 * a repeat within the same session a no-op. The startup check keeps a restart
 * loop from hammering the open-data portal.
 */
export function startScheduler(): void {
  if (!env.ingestionEnabled) {
    log.info('ingestion scheduler disabled (INGESTION_ENABLED=false)');
    return;
  }

  // Serverless has no process to hold a timer between requests: the container
  // is frozen the moment a response is sent, so an interval would fire once at
  // best and never again. Vercel Cron calls /api/cron/refresh instead.
  if (env.isServerless) {
    log.info('serverless runtime detected — refreshes come from Vercel Cron, not an interval');
    return;
  }

  const intervalMs = Math.max(5, env.ingestionIntervalMinutes) * 60_000;

  const tick = async (trigger: 'startup' | 'schedule'): Promise<void> => {
    try {
      if (trigger === 'startup') {
        const recent = await prisma.ingestionRun.findFirst({
          where: { adapterKey: 'csx-summary', status: { not: 'failed' } },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true },
        });
        if (recent && Date.now() - recent.startedAt.getTime() < intervalMs) {
          log.info('skipping startup refresh; the daily feeds are already current');
          return;
        }
      }
      const outcomes = await runDaily(trigger);
      log.info(`daily refresh complete — ${outcomes.map((o) => `${o.key}:${o.status}`).join(' ')}`);
    } catch (error) {
      log.error('scheduled refresh failed', error);
    }
  };

  void tick('startup');
  timer = setInterval(() => void tick('schedule'), intervalMs);
  timer.unref();
  log.info(`ingestion scheduler running every ${env.ingestionIntervalMinutes} minute(s)`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
