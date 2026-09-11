import { rootCertificates } from 'node:tls';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { logger } from '../core/logger.ts';
import { MEF_ROOT_CA } from './mefRootCa.ts';

const log = logger('ingest:portal');

/**
 * A dispatcher for calls to the Cambodian open-data portal.
 *
 * The portal's certificate chain terminates at "AAA Certificate Services", a
 * legacy root macOS and Windows still trust but which Node no longer bundles,
 * so Node cannot build a trust path and every request fails. Adding that one
 * root — alongside, not instead of, Node's own list — lets verification
 * succeed normally. The certificate is bundled (see `mefRootCa.ts`) so this
 * works identically on a laptop and in a serverless build.
 *
 * Certificate verification stays on, and nothing here reaches beyond the
 * portal: the dispatcher is passed per request rather than installed globally,
 * so no other connection the process makes is affected.
 */
function buildDispatcher(): Agent | undefined {
  try {
    return new Agent({
      connect: { ca: [...rootCertificates, MEF_ROOT_CA] },
      headersTimeout: 30_000,
      bodyTimeout: 60_000,
    });
  } catch (error) {
    // Not fatal: on hosts whose Node already trusts the chain, the default
    // roots work fine.
    log.warn('could not build the portal dispatcher; using default TLS roots', error);
    return undefined;
  }
}

const dispatcher = buildDispatcher();

// --- Politeness ------------------------------------------------------------
// The portal is a small public service that rate-limits bulk reads with 429s.
// Requests are serialised with a minimum gap, and retried with backoff, so a
// full import stays well inside what the publisher is willing to serve.

const MIN_GAP_MS = 350;
const MAX_ATTEMPTS = 4;

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PortalResponse = Awaited<ReturnType<typeof undiciFetch>>;

async function attempt(url: string, init: UndiciRequestInit): Promise<PortalResponse> {
  const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return undiciFetch(url, { ...init, ...(dispatcher ? { dispatcher } : {}) });
}

async function fetchWithBackoff(url: string, init: UndiciRequestInit): Promise<PortalResponse> {
  let lastResponse: PortalResponse | undefined;

  for (let tries = 1; tries <= MAX_ATTEMPTS; tries += 1) {
    const response = await attempt(url, init);
    if (response.status !== 429 && response.status < 500) return response;

    lastResponse = response;
    if (tries === MAX_ATTEMPTS) break;

    // Honour Retry-After when the portal sends it; otherwise back off
    // exponentially from one second.
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** tries * 500;
    log.warn(`portal returned ${response.status}; retrying in ${delay}ms`, url);
    await sleep(delay);
  }

  return lastResponse!;
}

/**
 * Fetches from the open-data portal with its trust anchor, request pacing and
 * retry policy applied.
 *
 * Requests go through undici's own `fetch` rather than the global one, because
 * Node's built-in fetch rejects a dispatcher built by a separately installed
 * copy of undici (`UND_ERR_INVALID_ARG`).
 */
export function portalFetch(url: string, init: UndiciRequestInit = {}): Promise<PortalResponse> {
  // Chain onto the queue so only one portal request is in flight at a time.
  const result = queue.then(
    () => fetchWithBackoff(url, init),
    () => fetchWithBackoff(url, init),
  );
  queue = result.catch(() => undefined);
  return result;
}
