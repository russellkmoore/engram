/**
 * RED stub — `packages/mcp-server/src/oauth.ts` (OAuth `defaultHandler`).
 *
 * Wave 0 contract: this file declares 4 `it.skip` cases that document the
 * test surface Wave 2 (Plan 03-04 — oauth.ts) will turn GREEN. Vitest
 * collects skipped tests without importing the (as-yet-nonexistent)
 * `../oauth.js` module.
 *
 * Wave 2 plan (03-04 — oauth.ts) will:
 *   1. Create `packages/mcp-server/src/oauth.ts` exporting
 *      `const defaultHandler: ExportedHandler<Env>` per RESEARCH §Pattern 3.
 *   2. Replace each `it.skip(...)` below with `it(...)` + real body that
 *      exercises the `/health`, `/`, and `/authorize` paths against the
 *      live workerd runtime.
 *
 * Defense-in-depth contracts asserted by Wave 2 GREEN:
 *   - T-03-JWT: unauthenticated `/mcp` returns 401 (OAuthProvider is the
 *     primitive; this stub asserts the contract at the `defaultHandler`
 *     boundary).
 *   - T-03-PROPS: `/authorize` ONLY derives `props.{workspace_id, user_id}`
 *     from the `ENGRAM_IDENTITIES` KV lookup keyed on the OAuth `sub` claim
 *     — never from request body, query params, or headers.
 *
 * @module @engram/mcp-server/__tests__/oauth
 */
import { describe, it } from "vitest";

describe("oauth (Wave 2 RED — 03-04 GREEN)", () => {
  // Case 1: /health is a no-auth public route (D-08)
  // Wave 2 asserts: defaultHandler.fetch(new Request("https://x/health"), env, ctx)
  //                 returns 200 with body { status: "ok", ... } and no Authorization header check.
  it.skip("/health returns {status:'ok'} without auth", () => {
    // Wave 2 imports `defaultHandler` from `../oauth.js`, builds a minimal env stub, and asserts
    // the 200 response shape.
  });

  // Case 2: / (root) returns project info JSON (no auth) (D-08)
  // Wave 2 asserts: response body includes name, mcp endpoint, oauth metadata link.
  it.skip("/ returns project info JSON without auth", () => {
    // Wave 2 mirrors the /health case with the root path.
  });

  // Case 3: /authorize → ENGRAM_IDENTITIES KV lookup populates props (D-04, T-03-PROPS)
  // Wave 2 asserts: with KV entry { workspace_id: "rmoore-personal", user_id: "rmoore" }
  //                 present at key=`sub`, `defaultHandler.fetch('/authorize')` calls
  //                 `env.OAUTH_PROVIDER.completeAuthorization({ props: { workspace_id, user_id } })`
  //                 with the EXACT same values — derived ONLY from the KV lookup, never from
  //                 request body / query params (T-03-PROPS defense-in-depth contract).
  it.skip("/authorize with valid ENGRAM_IDENTITIES KV entry passes props to completeAuthorization", () => {
    // Wave 2 stubs env.ENGRAM_IDENTITIES.get to return the identity JSON and asserts the
    // env.OAUTH_PROVIDER.completeAuthorization call shape.
  });

  // Case 4: /authorize → no KV entry → 403 (T-03-PROPS — fail-closed)
  // Wave 2 asserts: with NO ENGRAM_IDENTITIES KV entry for the OAuth `sub`,
  //                 `defaultHandler.fetch('/authorize')` returns a 403 response whose body
  //                 contains the literal string "Unknown OAuth subject" — the fail-closed
  //                 path documented in RESEARCH §Pattern 3 (D-04 / Plan 06 README).
  it.skip("/authorize with missing ENGRAM_IDENTITIES KV entry returns 403 with 'Unknown OAuth subject'", () => {
    // Wave 2 stubs env.ENGRAM_IDENTITIES.get to return null and asserts the 403 + body shape.
  });
});
