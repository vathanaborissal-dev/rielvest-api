import { disconnectPrisma } from '../core/prisma.ts';
import { ADAPTERS, DAILY_ADAPTER_KEYS, ensureSourcesRegistered, runAdapters } from './runner.ts';

const USAGE = `
RielVest ingestion

  npm run seed                        register sources, then run every adapter
  npm run ingest -- all               run every adapter
  npm run ingest -- daily             run only the daily market feeds
  npm run ingest -- <key> [key...]    run specific adapters

Adapters: ${ADAPTERS.map((adapter) => adapter.key).join(', ')}
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    console.log(USAGE);
    return;
  }

  const command = args[0]!;
  if (command === 'seed') await ensureSourcesRegistered();

  const keys =
    command === 'seed' || command === 'all'
      ? ADAPTERS.map((adapter) => adapter.key)
      : command === 'daily'
        ? [...DAILY_ADAPTER_KEYS]
        : args;

  const outcomes = await runAdapters(keys, 'manual');

  let failed = false;
  for (const outcome of outcomes) {
    console.log(
      `${outcome.status.padEnd(7)} ${outcome.key.padEnd(16)} read=${outcome.rowsRead} written=${outcome.rowsWritten} skipped=${outcome.rowsSkipped} (${outcome.durationMs}ms)`,
    );
    for (const warning of outcome.warnings) console.log(`        ! ${warning}`);
    if (outcome.error) {
      console.log(`        x ${outcome.error}`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
