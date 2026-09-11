import 'dotenv/config';
import { defineConfig } from '@prisma/config';

/**
 * Prisma 7 reads connection details from here rather than from the schema.
 *
 * Migrations run DDL, which Supabase's connection poolers cannot do, so they
 * use DIRECT_URL. The application itself connects through the pooled
 * DATABASE_URL via the pg driver adapter in `src/core/prisma.ts`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --experimental-strip-types --disable-warning=ExperimentalWarning src/ingest/cli.ts seed',
  },
});
