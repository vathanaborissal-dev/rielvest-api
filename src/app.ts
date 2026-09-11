import cookieParser from 'cookie-parser';
import cors from 'cors';
import { isAllowedOrigin } from './core/cors.ts';
import express, { type Express } from 'express';
import { env } from './config/env.ts';
import { errorHandler, notFoundHandler } from './core/http.ts';
import { authRouter } from './modules/auth/auth.routes.ts';
import { companiesRouter } from './modules/companies/companies.routes.ts';
import { marketRouter } from './modules/market/market.routes.ts';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin:
        env.corsOrigins.length > 0
          ? (origin, callback) => {
              // Server-to-server callers send no Origin at all — the UI's own
              // page rendering among them. Only browsers are being gated here.
              if (!origin) return callback(null, true);
              callback(null, isAllowedOrigin(origin, env.corsOrigins));
            }
          : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'rielvest-api',
      time: new Date().toISOString(),
      runtime: env.isServerless ? 'serverless' : 'server',
      // Names where refreshes come from, so a deployment whose data has stopped
      // moving can be diagnosed without reading the source.
      refresh: env.isServerless
        ? 'vercel-cron'
        : env.ingestionEnabled
          ? 'in-process-scheduler'
          : 'disabled',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/market', marketRouter);
  app.use('/api/companies', companiesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
