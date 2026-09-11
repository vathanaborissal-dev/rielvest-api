import { isNarrativeEnabled } from './ai/narrator.ts';
import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { logger } from './core/logger.ts';
import { disconnectPrisma } from './core/prisma.ts';
import { startScheduler, stopScheduler } from './ingest/scheduler.ts';

const log = logger('server');
const app = createApp();

const server = app.listen(env.port, () => {
  log.info(`RielVest API listening on http://localhost:${env.port}`);
  // Said out loud at boot: the engine-text fallback is silent by design, which
  // makes an unset key look like a broken feature rather than a choice.
  log.info(
    isNarrativeEnabled()
      ? `Narratives: ${env.geminiModel} (number-guarded)`
      : 'Narratives: engine sentences — set GEMINI_API_KEY to enable model phrasing',
  );
  startScheduler();
});

async function shutdown(signal: string): Promise<void> {
  log.info(`${signal} received, shutting down`);
  stopScheduler();
  server.close();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
