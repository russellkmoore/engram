---
phase: 03-mcp-server-scaffold
plan: 04
subsystem: mcp-server
tags: [mcp-server, oauth, cloudflare-kv, jwt-props, defense-in-depth]

# Dependency graph
requires:
  - phase: 03-mcp-server-scaffold
    plan: 01
    provides: "EngramProps interface published from packages/mcp-server/src/index.ts; the EngramMcp class generic position locked to McpAgent<Env, unknown, EngramProps>; @cloudflare/workers-oauth-provider@0.7.0 installed; vitest infra + oauth.test.ts RED stub (4 it.skip cases) already wired"
provides:
  - "packages/mcp-server/src/oauth.ts — exports `defaultHandler: ExportedHandler<EngramOAuthEnv>` consumed by `@cloudflare/workers-oauth-provider`'s `OAuthProvider` as the non-API fall-through"
  - "GET / public route returning project info JSON (D-08, no auth)"
  - "GET /health public route returning status:ok JSON (D-08, no auth)"
  - "GET /authorize consent step: parseAuthRequest → lookupClient → ENGRAM_IDENTITIES KV lookup → completeAuthorization with props sourced EXCLUSIVELY from the parsed KV record (T-03-PROPS)"
  - "Structured 403 path: `Unknown OAuth subject: <sub>. Bootstrap via npm run kv:bootstrap.` — never leaks KV value content (T-03-KV-LEAK)"
  - "Structured 500 path: `Internal error: corrupt identity record` — sanitized literal on JSON.parse failure (T-03-PARSE)"
  - "404 fall-through for any path other than /, /health, /authorize"
  - "oauth.test.ts GREEN: 6 passing tests (was 4 skipped) covering all 4 routes + T-03-PROPS structural lock + T-03-KV-LEAK structural lock + T-03-PARSE structural lock"
affects: [03-05-index-integration, 03-06-deploy-docs]

# Tech tracking
tech-stack:
  added:
    - "module-scoped EngramOAuthEnv augmentation pattern — extends the codegen `Env` with library bindings (ENGRAM_IDENTITIES, OAUTH_KV, OAUTH_PROVIDER) without redeclaring the global Env interface"
  patterns:
    - "Plain `ExportedHandler<Env>` for OAuth defaultHandler — no DO instantiation required by tests; mock env built inline via `vi.fn()` and passed through a `Parameters<typeof fetcher>[N]` cast"
    - "Request type bridge `Request<unknown, CfProperties>` ↔ `Request<unknown, IncomingRequestCfProperties>` via narrow cast — handler reads only `request.url` so the additional Cloudflare-incoming fields are never accessed"
    - "Generic `response.json<T>()` for parsed body assertions — replaces the cast `(await response.json()) as T` which the typescript-eslint strict-type-checked rule rejects as unnecessary on the workerd Response shape"

key-files:
  created:
    - "packages/mcp-server/src/oauth.ts"
  modified:
    - "packages/mcp-server/src/__tests__/oauth.test.ts (RED → GREEN; 4 it.skip → 6 it)"

key-decisions:
  - "Used module-scoped `interface EngramOAuthEnv extends Env { ENGRAM_IDENTITIES, OAUTH_KV, OAUTH_PROVIDER }` instead of a local `interface Env` declaration. Wave 0 (Plan 03-01) hit the global-Env shadowing bug when index.ts redeclared `interface Env` — TypeScript's declaration merging collapsed the DO type parameters. Naming the augmentation differently (`EngramOAuthEnv`) and extending the codegen Env keeps the codegen typing intact while adding the OAuth surface this handler needs."
  - "Omitted the `_ctx` (ExecutionContext) parameter from `fetch(request, env)` rather than declaring it as `_ctx` with a discard prefix. TypeScript allows callbacks shorter than the declared signature; the eslint `no-unused-vars` rule (no `argsIgnorePattern` configured) would flag `_ctx`. Defaultandler does not call `waitUntil` or `passThroughOnException`, so the missing parameter is structurally fine."
  - "Sanitized 500 message is the EXACT literal `Internal error: corrupt identity record` — chosen over including a generic correlation ID or hashed value. The string is structurally locked by the test (`expect(text).toBe(...)`), so a future refactor that accidentally includes parser detail will fail CI."
  - "T-03-PROPS structural assertion uses BOTH `expect(props).toEqual({...})` AND `expect(Object.keys(props).sort()).toEqual([...])` — the first checks values, the second locks the key count and prevents a future contributor from adding an undeclared third field to props without breaking the test."
  - "T-03-KV-LEAK structural assertion in the 403 test asserts the body does NOT contain the literal strings `workspace_id` or `user_id` — the KV value is null on miss, but this negative assertion locks the invariant against a future refactor that might decide to echo the KV value for debugging."
  - "Used `await response.json<Record<string, unknown>>()` (generic call) instead of `(await response.json()) as Record<string, unknown>` (cast). The workerd Response.json signature in worker-configuration.d.ts is `json<T>(): Promise<T>`, making the cast unnecessary per `@typescript-eslint/no-unnecessary-type-assertion`."

patterns-established:
  - "Module-scoped Env augmentation for Worker handler modules that need bindings not yet in the codegen Env — extend `Env` under a new name (`EngramOAuthEnv`, etc.) rather than redeclaring `interface Env` at module scope (which interacts poorly with the codegen via TS declaration merging)."
  - "Mock-env helper pattern for ExportedHandler unit tests: a `makeMockEnv()` factory returning the subset of bindings the handler touches, each typed as `ReturnType<typeof vi.fn>`. Per-test overrides via a single options arg keep test bodies focused on assertions."

requirements-completed: [MCP-04]
# Note: MCP-04 ("JWT validation middleware extracts workspace_id + user_id from
# the bearer token and exposes them on this.props") is the OBJECT this plan
# delivers, not the verb. defaultHandler does not validate JWTs — OAuthProvider
# does that automatically before dispatching to apiHandler (EngramMcp.serve("/mcp")).
# What this plan delivers is the consent step that POPULATES props in the JWT
# in the first place — sourcing them EXCLUSIVELY from ENGRAM_IDENTITIES KV
# per T-03-PROPS. Plan 05's index.ts integration completes the full surface
# (apiHandler mounting + JWT validation routing) but the props pipeline is
# fully wired here.

# Metrics
duration: 18m
completed: 2026-05-26
---

# Phase 3 Plan 04: OAuth defaultHandler Summary

**Plan 03-04 is complete: `packages/mcp-server/src/oauth.ts` exports a `defaultHandler` ExportedHandler serving `/` + `/health` (D-08 public routes) and `/authorize` (KV-backed consent step). `oauth.test.ts` is GREEN with 6 passing tests covering all 4 routes plus three threat-mitigation contracts (T-03-PROPS, T-03-KV-LEAK, T-03-PARSE) structurally locked.**

## Outcome

- **`packages/mcp-server/src/oauth.ts`** is the OAuth provider's non-API fall-through. The OAuthProvider (declared in Plan 05's `index.ts` swap) will dispatch every request that does NOT match `apiRoute: "/mcp"` to this handler, AFTER intercepting the library-owned discovery routes (`/.well-known/*`, `/token`, `/jwks`, `/register`) per RESEARCH Pitfall 4.
- **The `/authorize` consent step** sources `props.{workspace_id, user_id}` EXCLUSIVELY from `await env.ENGRAM_IDENTITIES.get(sub)` where `sub = oauthReqInfo.clientId` (v0.1 simplification per RESEARCH Open Question 3 — resolved by Plan 06's smoke). The 2-key props object is constructed as a literal whose values come ONLY from `identity.*` (the parsed KV record); no request-derived fields leak into props.
- **The three threat mitigations** (T-03-PROPS / T-03-KV-LEAK / T-03-PARSE) are STRUCTURALLY enforced in both production code AND the test file. Each contract has a dedicated `it(...)` case with negative assertions that prevent regressions during future refactors.
- **Wave 0's 4 RED stubs** (`it.skip(...)`) in `oauth.test.ts` are now 6 GREEN `it(...)` tests. Each Wave 0 stub maps to a Wave 2 GREEN test plus 2 additional tests added for T-03-PARSE coverage and the 404 fall-through.

## Performance

- **Duration:** ~18 minutes (start of agent spawn to SUMMARY commit)
- **Tasks:** 2 (Task 1 source, Task 2 test transition — both `auto` `tdd="true"`)
- **Files created:** 1 (`packages/mcp-server/src/oauth.ts`, 224 lines)
- **Files modified:** 1 (`packages/mcp-server/src/__tests__/oauth.test.ts`, 4 it.skip → 6 it; 309 lines)

## Files Changed

### Created (1)

- **`packages/mcp-server/src/oauth.ts`** — 224 lines. Exports `const defaultHandler: ExportedHandler<EngramOAuthEnv>`. Top-of-file JSDoc documents the cross-phase contract (Wave 1+ schemas, Plan 05 index.ts integration, Plan 06 deploy docs), the four locked design notes (T-03-PROPS, T-03-KV-LEAK, T-03-PARSE, D-08 public routes), the v0.1 `sub`-claim simplification with reference to RESEARCH Open Question 3, and the Env augmentation pattern. Three inline interfaces: `IdentityRecord` (KV value shape), `EngramOAuthEnv` (codegen Env + library bindings), and the handler itself. The fetch body has four route branches: `/` → project info JSON; `/health` → status:ok JSON; `/authorize` → KV lookup + completeAuthorization with structured 403/500 fail paths; 404 fall-through.

### Modified (1)

- **`packages/mcp-server/src/__tests__/oauth.test.ts`** — 309 lines (was 63 lines with 4 it.skip stubs). Imports `defaultHandler` from `../oauth.js`, uses Vitest `vi.fn()` for OAuth helper mocks. A `makeMockEnv()` factory returns a typed subset of the production `EngramOAuthEnv` with all OAUTH_PROVIDER + ENGRAM_IDENTITIES surface as `vi.fn()`. A `callFetch()` helper wraps the `defaultHandler.fetch(request, env, ctx)` call with the Request/Env/ExecutionContext casts at one boundary so individual tests stay readable. Three describe blocks: public routes (D-08), /authorize flow (threat mitigations), and the fall-through 404.

## Verification

All plan `<verification>` steps passed:

1. **mcp-server oauth test suite (formerly skipped tests now GREEN):**
   ```bash
   npm test --workspace=@engram/mcp-server -- --run oauth
   ```
   `Test Files 1 passed (1) | Tests 6 passed (6)` — PASS.

2. **Full mcp-server test suite (non-regression of other test files):**
   ```bash
   npm test --workspace=@engram/mcp-server -- --run
   ```
   `Test Files 1 passed | 3 skipped (4) | Tests 6 passed | 16 skipped (22)` — PASS. The 16 skipped are schemas.test.ts (6), tools.test.ts (7), index.test.ts (3) — those are owned by Plans 03-02, 03-03, and 03-05 respectively.

3. **TypeScript compiles cleanly:**
   ```bash
   npx tsc -p packages/mcp-server/tsconfig.json --noEmit
   ```
   Exit 0, no output — PASS.

4. **T-03-KV-LEAK structural check (no stringify of raw KV value in non-comment code):**
   ```bash
   grep -v -E "^[[:space:]]*(//|\*)" packages/mcp-server/src/oauth.ts | grep -E "JSON\.stringify\(\s*raw\)"
   ```
   Returns 0 matches — PASS.

5. **T-03-PROPS structural check (props only sources from `identity.`):**
   ```bash
   grep -A 3 "props:" packages/mcp-server/src/oauth.ts | grep -E "workspace_id:|user_id:" | wc -l
   ```
   Returns 2 (both fields present in the props literal). Both reference `identity.workspace_id` and `identity.user_id`, never `request.` or `args.` — PASS.

6. **Phase 2 cross-package non-regression:**
   ```bash
   npm test --workspaces -- --run
   ```
   workspace-do: `Test Files 6 passed (6) | Tests 25 passed | 1 skipped (26)` — PASS. (The npm errors for `@engram/types` and `@engram/schema` are pre-existing — those packages have no `test` script defined; not caused by this plan.)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create `packages/mcp-server/src/oauth.ts` (defaultHandler with /, /health, /authorize)** — `8f61de6` (feat)
2. **Task 2: Turn oauth.test.ts from RED to GREEN (6 tests covering all routes + 3 threat contracts)** — `a8b9e7d` (test)

## Cross-Phase Contracts

**Plan 03-05 (index.ts integration) — DOWNSTREAM:**

- Plan 03-05 will wire `defaultHandler` into the OAuthProvider default-export configuration via:
  ```typescript
  import { defaultHandler } from "./oauth.js";
  export default new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler: EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" }),
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
  });
  ```
- Plan 03-05 will also update `wrangler.jsonc` to add the `ENGRAM_IDENTITIES` + `OAUTH_KV` KV bindings (Wave 0's Plan 01 created `wrangler.test.jsonc` without KV bindings — Plan 03-05 brings parity to the production config) and regenerate `worker-configuration.d.ts` via `wrangler types`. Once that lands, the module-scoped `EngramOAuthEnv` augmentation in this file can be simplified to `interface EngramOAuthEnv extends Env { OAUTH_PROVIDER: OAuthHelpers }` (just the runtime helper); the two KV bindings will appear on the codegen `Env` directly.

**Plan 03-06 (DEP-05 README) — DOWNSTREAM:**

- The structured 403 body `Unknown OAuth subject: <sub>. Bootstrap via npm run kv:bootstrap.` is the surface Russell sees during the 2-step bootstrap flow (RESEARCH Open Question 6 — RESOLVED): first call to `/authorize` fails with 403, Russell reads the `sub` from the error, runs `npm run kv:bootstrap -- --sub <sub>`, retries. Plan 06's README documents this flow verbatim.
- The `Unknown OAuth subject` literal is structurally asserted by `oauth.test.ts` Case 4 (`expect(text).toContain("Unknown OAuth subject")`), so a future refactor that changes the error wording will fail CI — locking the contract.

**Plan 04+ tool handlers — DOWNSTREAM:**

- The `props.{workspace_id, user_id}` shape this handler writes to the JWT via `completeAuthorization` is the EXACT shape Phase 4 tool handlers read via `this.props.workspace_id` and `this.props.user_id` in their bodies. The 2-key structural lock here (T-03-PROPS) means no extraneous fields will appear in `this.props` for tools to read — combined with `assertOwnsWorkspace` in WorkspaceDO (Phase 2 STO-07), this is the defense-in-depth chain that prevents a forged workspace_id from reaching SQLite.

## Threat Model Discharge

All applicable threats from the plan's `<threat_model>` block are mitigated:

- **T-03-JWT (Spoofing — OAuthProvider library):** Mitigated structurally by using the library. `defaultHandler` never receives a `/mcp` request; OAuthProvider validates JWT signatures before dispatching to `apiHandler` (the `EngramMcp.serve("/mcp")` path). The library's validation is RFC 6749/9728 compliant per RESEARCH §Standard Stack. Test Case 1 (`/` no auth) and Case 2 (`/health` no auth) prove that the OAuth-handler helpers are NOT consulted for D-08 public routes — they bypass JWT validation by design.
- **T-03-PROPS (Spoofing/EoP — `/authorize` handler):** Mitigated. The `/authorize` handler sources `props.{workspace_id, user_id}` EXCLUSIVELY from `await env.ENGRAM_IDENTITIES.get(sub)`. `completeAuthorization()` is invoked with a literal `{ workspace_id: identity.workspace_id, user_id: identity.user_id }` props object. Test Case 3 asserts BOTH the value equality (`expect(props).toEqual({...})`) AND the key count (`Object.keys(props).sort()`).
- **T-03-KV-LEAK (Information Disclosure — 403 path):** Mitigated. The 403 response body contains ONLY the literal `Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.`. The `sub` is echoed (it's already known to the requester — their own dynamically-registered client id). No KV value content appears anywhere. Test Case 4 asserts both the positive (message contains "Unknown OAuth subject") AND the negative (body does NOT contain `workspace_id` or `user_id` keywords).
- **T-03-PARSE (Tampering — JSON.parse on KV value):** Mitigated. `JSON.parse(raw)` is wrapped in `try/catch`. On parse failure the 500 body is the SANITIZED literal `Internal error: corrupt identity record` — no raw value content, no parser error message. Test Case 5 asserts the exact literal via `expect(text).toBe(...)` AND asserts the body does NOT contain the malformed JSON fragments (`"this-is-not-json"`, `"{{{"`).
- **T-03-CALL (Spoofing — parseAuthRequest / lookupClient):** Mitigated. Library-provided; an invalid request or unknown client throws an exception that propagates to OAuthProvider's error responder (a 400 per RFC 6749). `defaultHandler` deliberately does NOT catch these — propagation is intentional per RESEARCH Pattern 3.
- **T-03-DD-IN (Tampering — schemas inheriting workspace_id absence):** Inherited from Plan 03-02. Out of scope for this plan.
- **T-03-DD-RT (Tampering — tools.ts inheriting workspace_id absence):** Inherited from Plan 03-03. Out of scope for this plan.
- **T-03-SC (Tampering — @cloudflare/workers-oauth-provider supply chain):** Inherited from Plan 03-01. The package was slopchecked at `0.7.0` with [OK] verdict; exact-pinned in `packages/mcp-server/package.json`.

## Threat Flags

None. The new files do not introduce security-relevant surface beyond what the threat model already documents.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESLint `no-unused-vars` rejects `_ctx` parameter in fetch handler**
- **Found during:** Task 1 first commit attempt (pre-commit eslint hook)
- **Issue:** ESLint's `@typescript-eslint/no-unused-vars` rule from the strict-type-checked preset rejects parameters with a `_` prefix when no `argsIgnorePattern` is configured in `eslint.config.mjs`. The plan's `<action>` suggested writing `async fetch(request, env, _ctx): Promise<Response>`; this failed CI on the first attempt.
- **Fix:** Removed the `_ctx` parameter entirely. TypeScript permits callbacks shorter than the declared `ExportedHandlerFetchHandler` signature (the type is structural). The handler doesn't call `waitUntil` or `passThroughOnException`, so the missing parameter is functionally equivalent. Added an inline comment block above the `fetch(request, env)` line explaining the omission.
- **Files modified:** `packages/mcp-server/src/oauth.ts`
- **Verification:** `npx eslint packages/mcp-server/src/oauth.ts` exits 0; `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` exits 0.
- **Committed in:** `8f61de6` (Task 1, single commit — the first attempt was reverted by the lint-staged failure)

**2. [Rule 3 - Blocking] Request type variance — `new Request(url)` vs `ExportedHandlerFetchHandler`'s first arg**
- **Found during:** Task 2 typecheck after writing the test bodies
- **Issue:** `new Request("https://example.dev/")` produces a `Request<unknown, CfProperties<unknown>>`. The `defaultHandler.fetch` first parameter is typed as `Request<unknown, IncomingRequestCfProperties<unknown>>` — the "incoming" variant has additional Cloudflare-edge-only fields (`colo`, `edgeRequestKeepAliveStatus`, `httpProtocol`, etc.). `exactOptionalPropertyTypes: true` made this incompatibility a hard error: `TS2379: Argument of type 'Request<unknown, CfProperties<unknown>>' is not assignable to parameter of type 'Request<unknown, IncomingRequestCfProperties<unknown>>'`.
- **Fix:** Added a narrow cast in the `callFetch()` helper: `request as unknown as Parameters<typeof fetcher>[0]`. The handler only reads `request.url`, so the extra fields are never accessed. The cast is documented inline with the same rationale.
- **Files modified:** `packages/mcp-server/src/__tests__/oauth.test.ts`
- **Verification:** `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` exits 0.
- **Committed in:** `a8b9e7d` (Task 2, single commit)

**3. [Rule 1 - Bug] ESLint `no-unnecessary-type-assertion` rejects `(await response.json()) as Record<string, unknown>`**
- **Found during:** Task 2 commit attempt (pre-commit eslint hook)
- **Issue:** The workerd `Response.json` signature in `worker-configuration.d.ts` is `json<T>(): Promise<T>` (generic with caller-supplied type parameter). Casting `await response.json()` to a type is therefore an unnecessary type assertion — the assertion does not change the inferred type. The strict-type-checked preset rejects this with `@typescript-eslint/no-unnecessary-type-assertion`.
- **Fix:** Replaced `(await response.json()) as Record<string, unknown>` with the generic call form `await response.json<Record<string, unknown>>()` in two places.
- **Files modified:** `packages/mcp-server/src/__tests__/oauth.test.ts`
- **Verification:** `npx eslint packages/mcp-server/src/__tests__/oauth.test.ts` exits 0; tests still pass.
- **Committed in:** `a8b9e7d` (Task 2, single commit — first commit attempt reverted by lint-staged failure)

### Architectural Decisions Inline

**1. Module-scoped `EngramOAuthEnv` instead of redeclaring `interface Env` locally.** Plan 03-01's Wave 0 retrospective documented a TS declaration-merging bug where `index.ts` redeclared `interface Env` and collapsed the DO type parameters (`MCP_OBJECT.get` returned `DurableObjectStub<undefined>` instead of `DurableObjectStub<EngramMcp>`). To avoid the same trap, this plan declares the augmentation under a different name (`EngramOAuthEnv extends Env`) — the codegen `Env` retains its DO typing, and the OAuth-specific fields ride on top without merging. This is now a repeatable pattern for any Worker handler module that needs bindings not yet in the codegen Env (Plan 03-05's `index.ts` rewrite will fold the KV bindings into the codegen and obviate this augmentation).

Rationale documented in the SUMMARY's `key-decisions` array AND in the `oauth.ts` top-of-file JSDoc.

### Deferred Issues

None. The plan executed cleanly; the three auto-fixes are minor structural-mechanical adjustments to satisfy the strict eslint and typecheck posture.

---

**Total deviations:** 3 auto-fixed (1 Rule 1 - Bug, 2 Rule 3 - Blocking). 0 Deferred.
**Impact on plan:** All three auto-fixes are minimal mechanical adjustments to satisfy the project's strict typescript-eslint + exactOptionalPropertyTypes posture. None change the prescribed semantics, file layout, or contract surface. The plan's success criteria are fully met.

## Known Stubs

None. Plan 03-04's output (`oauth.ts` + GREEN `oauth.test.ts`) is production-ready for Plan 03-05's integration:

- `defaultHandler` is wired and tested; Plan 05 imports it as-is.
- `EngramOAuthEnv` is a temporary type bridge — Plan 05's `wrangler types` regeneration will fold `ENGRAM_IDENTITIES` and `OAUTH_KV` into the codegen `Env`, after which this augmentation can be simplified to `interface EngramOAuthEnv extends Env { OAUTH_PROVIDER: OAuthHelpers }` (or even removed entirely if Plan 05 hoists the OAuthHelpers type into the codegen). This is a forward-note, not a stub.

The other 3 test files in `packages/mcp-server/src/__tests__/` (`schemas.test.ts`, `tools.test.ts`, `index.test.ts`) remain `it.skip` stubs — those are owned by Plans 03-02, 03-03, and 03-05 respectively and are NOT in scope for this plan.

## Self-Check

Verified before composing this summary:

- `[ -f packages/mcp-server/src/oauth.ts ]` → **FOUND**
- `[ -f packages/mcp-server/src/__tests__/oauth.test.ts ]` (modified) → **FOUND**
- Commit `8f61de6` present in `git log` → **FOUND**
- Commit `a8b9e7d` present in `git log` → **FOUND**
- `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` exits 0 → **PASS**
- `npm test --workspace=@engram/mcp-server -- --run oauth` exits 0 with 6 passed / 0 failed → **PASS**
- `npm test --workspace=@engram/mcp-server -- --run` exits 0 with 6 passed / 16 skipped → **PASS**
- `grep -q "export const defaultHandler" packages/mcp-server/src/oauth.ts` → **PASS**
- `grep -q "ENGRAM_IDENTITIES" packages/mcp-server/src/oauth.ts` → **PASS**
- `grep -q "completeAuthorization" packages/mcp-server/src/oauth.ts` → **PASS**
- `grep -q "parseAuthRequest" packages/mcp-server/src/oauth.ts` → **PASS**
- `grep -q "lookupClient" packages/mcp-server/src/oauth.ts` → **PASS**
- `grep -q "Unknown OAuth subject" packages/mcp-server/src/oauth.ts` → **PASS**
- `grep -q "workspace_id: identity.workspace_id" packages/mcp-server/src/oauth.ts` → **PASS**
- `grep -q "user_id: identity.user_id" packages/mcp-server/src/oauth.ts` → **PASS**
- `grep -E "JSON\.stringify\(\s*raw\)" packages/mcp-server/src/oauth.ts` returns no matches → **PASS** (T-03-KV-LEAK structural check)
- `! grep -E "it\.(skip|todo)\(" packages/mcp-server/src/__tests__/oauth.test.ts` → **PASS** (no skipped tests)
- `grep -q "expect(completeAuthorization).toHaveBeenCalled" packages/mcp-server/src/__tests__/oauth.test.ts` → **PASS** (T-03-PROPS positive)
- `grep -q "expect(completeAuthorization).not.toHaveBeenCalled" packages/mcp-server/src/__tests__/oauth.test.ts` → **PASS** (T-03-KV-LEAK + T-03-PARSE negative — no completeAuthorization on the failure paths)
- Status codes 200, 302, 403, 500, 404 all asserted in tests → **PASS**

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 03-05 (index.ts integration swap) is UNBLOCKED.** `defaultHandler` is exported from `packages/mcp-server/src/oauth.ts` and ready for import. Plan 05 will:
  - Add `import { defaultHandler } from "./oauth.js";` to `packages/mcp-server/src/index.ts`.
  - Replace the Phase 1 default export with `new OAuthProvider({ apiRoute: "/mcp", apiHandler: EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" }), defaultHandler, authorizeEndpoint: "/authorize", tokenEndpoint: "/token", clientRegistrationEndpoint: "/register" })`.
  - Update `packages/mcp-server/wrangler.jsonc` to add the v2 migration entry + `ENGRAM_IDENTITIES` + `OAUTH_KV` KV bindings.
  - Regenerate `worker-configuration.d.ts` via `npm run types:gen --workspace @engram/mcp-server`.
  - Turn the 3 `index.test.ts` stubs GREEN (OAuthProvider default export, EngramMcp.init registers 5 tools — depends on Plan 03-03 — and wrangler.jsonc v1+v2 migrations).

- **Plan 03-06 (DEP-05 README) is UNBLOCKED.** The structured 403 error message `Unknown OAuth subject: <sub>. Bootstrap via npm run kv:bootstrap.` is locked in production code AND structurally asserted by Test Case 4. The 2-step bootstrap flow (first call /authorize → copy sub from 403 → run kv:bootstrap → retry) has the exact source-of-truth string Plan 06 needs to document.
