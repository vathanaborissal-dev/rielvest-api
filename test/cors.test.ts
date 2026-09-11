import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAllowedOrigin } from '../src/core/cors.ts';

/**
 * The price chart and command palette fetch from the browser, so these rules
 * are the difference between those features working in production and failing
 * with an opaque CORS error.
 */
describe('isAllowedOrigin', () => {
  const allowed = ['http://localhost:3000', 'https://rielvest.vercel.app', '*.vercel.app'];

  it('matches an exact origin', () => {
    assert.equal(isAllowedOrigin('http://localhost:3000', allowed), true);
    assert.equal(isAllowedOrigin('https://rielvest.vercel.app', allowed), true);
  });

  it('matches Vercel preview hostnames through the wildcard', () => {
    assert.equal(isAllowedOrigin('https://rielvest-ui-git-abc123-v.vercel.app', allowed), true);
  });

  it('refuses a look-alike domain that merely ends in the same letters', () => {
    // "notvercel.app" ends with "vercel.app" as a *string* but is a different site.
    assert.equal(isAllowedOrigin('https://evil-notvercel.app', allowed), false);
  });

  it('refuses the bare suffix itself', () => {
    assert.equal(isAllowedOrigin('https://vercel.app', allowed), false);
  });

  it('refuses http on a wildcard host', () => {
    assert.equal(isAllowedOrigin('http://preview.vercel.app', allowed), false);
  });

  it('refuses anything not listed', () => {
    assert.equal(isAllowedOrigin('https://example.com', allowed), false);
    assert.equal(isAllowedOrigin('null', allowed), false);
  });

  it('allows nothing when the list is empty', () => {
    assert.equal(isAllowedOrigin('https://rielvest.vercel.app', []), false);
  });
});
