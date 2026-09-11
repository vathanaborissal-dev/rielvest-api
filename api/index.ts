/**
 * Serverless entry point for Vercel.
 *
 * Vercel invokes a handler per request rather than running a long-lived
 * server, so this exports the Express app itself instead of calling `listen`.
 * `src/index.ts` remains the entry for running the API as an ordinary process
 * (locally, or on any host that keeps it alive).
 *
 * Every route is rewritten here by `vercel.json`, so this one function serves
 * the whole API and the Express router does the dispatching it already does.
 */
import { createApp } from '../src/app.ts';

export default createApp();
