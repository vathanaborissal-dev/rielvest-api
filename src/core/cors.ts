/**
 * Which browser origins may call the API.
 *
 * Two features fetch from the browser rather than the server — the price chart
 * and the command palette — so this list is what keeps them working in
 * production. Vercel gives every preview deployment a fresh hostname, so an
 * exact-match list would allow production and silently break previews. A
 * leading `*.` therefore matches any subdomain of a host you control.
 *
 * Entries may be written as a full origin (`https://rielvest.vercel.app`,
 * `http://localhost:3000`) or as a wildcard host (`*.vercel.app`). Wildcards
 * are https-only: an http origin on a public domain is either a downgrade or
 * an impostor, and neither should be trusted with credentialed requests.
 */
export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    if (!entry.startsWith('*.')) return entry === origin;

    const suffix = entry.slice(1); // "*.vercel.app" -> ".vercel.app"
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }

    return url.protocol === 'https:' && url.host.endsWith(suffix) && url.host.length > suffix.length;
  });
}
