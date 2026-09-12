/**
 * A tiny in-memory cache for pass-through data.
 *
 * Everything in `src/live/` is fetched when a reader asks for it and never
 * written to Postgres — it is context, not a record, and storing it would
 * quietly turn borrowed numbers into RielVest's own. The trade-off is that a
 * popular page could hammer the upstream source, so responses are held briefly
 * in process memory.
 *
 * On serverless this cache lives only as long as a warm function instance,
 * which is exactly the right lifetime: it is an optimisation, never a source of
 * truth, and a cold start simply fetches again.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

/** Runs `load` at most once per `ttlSeconds` for a given key. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const value = await load();
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
  return value;
}

/** Testing seam. */
export function clearLiveCache(): void {
  store.clear();
}
