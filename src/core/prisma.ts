import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.ts';
import { PrismaClient } from '../generated/prisma/client.ts';

/**
 * A single Prisma client for the process.
 *
 * Prisma 7 connects through a driver adapter, which lets the application use
 * Supabase's pooled connection string while migrations run over DIRECT_URL.
 *
 * Pool size is deliberately different on serverless. A Vercel function handles
 * one request at a time, so a pool of ten gains nothing — but every frozen
 * instance keeps its connections open against Supabase's pooler, and enough
 * concurrent instances will exhaust it. One connection per instance, released
 * quickly, is what the platform actually wants.
 */
const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: env.isServerless ? 1 : 10,
  idleTimeoutMillis: env.isServerless ? 10_000 : 30_000,
  connectionTimeoutMillis: 15_000,
  ...(env.databaseSsl === 'off'
    ? {}
    : env.databaseSsl === 'on' || !/@(localhost|127\.0\.0\.1)[:/]/.test(env.databaseUrl)
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
});

export const prisma: PrismaClient = new PrismaClient({
  adapter,
  log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export type { Prisma } from '../generated/prisma/client.ts';
