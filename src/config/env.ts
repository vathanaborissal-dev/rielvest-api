import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function toInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: toInt(optional('PORT', '4000'), 'PORT'),
  databaseUrl: required('DATABASE_URL'),
  /** Supabase pooled connections need SSL but present a shared certificate. */
  databaseSsl: optional('DATABASE_SSL', 'auto'),
  directUrl: process.env.DIRECT_URL ?? '',
  jwtSecret: required('JWT_SECRET'),
  accessTokenTtl: optional('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenDays: toInt(optional('REFRESH_TOKEN_DAYS', '30'), 'REFRESH_TOKEN_DAYS'),
  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Base URL of the Cambodian open-data portal that backs every market figure. */
  mefApiBase: optional('MEF_API_BASE', 'https://data.mef.gov.kh/api/v1'),
  /** Public chart API used by trade.csx.com.kh for historical and intraday bars. */
  csxChartApiBase: optional('CSX_CHART_API_BASE', 'https://api.csx.com.kh/tradingview/api/v1'),
  /** The exchange's own website API: index history, disclosures and dividends. */
  csxWebApiBase: optional('CSX_WEB_API_BASE', 'https://csx.com.kh/api/v1/website'),
  /** Public web-client token shipped by trade.csx.com.kh. May be overridden if CSX rotates it. */
  csxChartAccessToken: optional('CSX_CHART_ACCESS_TOKEN', 'AacCeEsStOk3n1'),
  /** Run the daily ingestion scheduler inside the API process. */
  ingestionEnabled: optional('INGESTION_ENABLED', 'true') === 'true',
  ingestionIntervalMinutes: toInt(optional('INGESTION_INTERVAL_MINUTES', '60'), 'INGESTION_INTERVAL_MINUTES'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  /**
   * True on Vercel and similar function runtimes, where no process survives
   * between requests. Anything that relies on a long-lived process — timers,
   * in-memory caches, warm connections — has to behave differently here.
   */
  isServerless: Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME),
  /** Shared secret Vercel Cron presents when calling the refresh endpoint. */
  cronSecret: process.env.CRON_SECRET ?? '',

  /**
   * Google AI Studio key for the narrative layer. Absent means the feature is
   * simply off: every page falls back to the deterministic sentences the
   * analysis engine already produces, which is why it is optional.
   */
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: optional('GEMINI_MODEL', 'gemini-3.8-flash'),
} as const;
