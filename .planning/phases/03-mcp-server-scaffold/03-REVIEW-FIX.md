---
phase: 03-mcp-server-scaffold
fixed_at: 2026-05-26T00:00:00Z
review_path: .planning/phases/03-mcp-server-scaffold/03-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 8
skipped: 1
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-05-26
**Source review:** [`03-REVIEW.md`](./03-REVIEW.md)
**Iteration:** 1

**Summary:**

- Findings in scope: 9 (CR-01 + WR-01..WR-08)
- Fixed: 8
- Skipped: 1 (WR-02 — already resolved before this fix pass)
- Info-tier findings (IN-01..IN-04): out of scope per `fix_scope=critical_warning`; deferred to Phase 4 follow-up.

**Verification gates (all passing on this branch):**

- `npm test --workspace=@engram/mcp-server -- --run` → **50/50 passed** (48 baseline + 2 new tests for WR-01 and WR-04)
- `npm test --workspace=@engram/workspace-do -- --run` → **25 passed + 1 pre-existing skip** (unchanged from baseline)
- `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` → exit 0
- `npx wrangler deploy --dry-run --config packages/mcp-server/wrangler.jsonc` → exit 0, all 4 bindings recognized
- `node -c scripts/kv-bootstrap.mjs` → syntax clean; `--dry-run` mode exercises both `--local` and `--remote` paths and the new WR-05 required-flag check

---

## Fixed Issues

### CR-01: README documents a fabricated `COOKIE_ENCRYPTION_KEY` secret

**Files modified:** `packages/mcp-server/README.md`
**Commit:** `c90fbea` (combined with WR-07 — both touch README)
**Applied fix:** Replaced the entire "Set the cookie encryption secret" subsection (~17 lines) with a "No additional secrets required" stub anchored to `@cloudflare/workers-oauth-provider@0.7.0`'s `OAuthProviderOptions` surface. The new subsection names the library version so a future contributor knows when to re-add a real binding section if the library ever introduces one. The misleading "if you rotate it, existing OAuth grants are invalidated" sentence (the security-relevant artifact creating a false sense of revocation) is removed entirely.

### WR-01: `oauth.ts` accepts any valid-JSON KV payload — no shape validation

**Files modified:** `packages/mcp-server/src/oauth.ts`, `packages/mcp-server/src/__tests__/oauth.test.ts`
**Commit:** `de1a659` (combined with WR-04 — same file, same try/catch block)
**Applied fix:** Added `IdentityRecordSchema = z.object({ workspace_id: z.string().min(1), user_id: z.string().min(1) })` and validated the parsed JSON inside the existing try/catch so the T-03-PARSE sanitized 500 path now covers shape mismatches (`null`, `{}`, wrong-typed fields) in addition to syntax errors. Made `IdentityRecord` a `z.infer` derivation so the runtime check and TypeScript shape cannot drift. Added one new test (`"valid JSON but wrong shape → 500 sanitized message"`) asserting `JSON.stringify({})` takes the same sanitized failure branch and `completeAuthorization` is never called with undefined fields.

### WR-02: Both KV namespaces share an identical placeholder ID

**Status:** Resolved before this fix pass — `packages/mcp-server/wrangler.jsonc:27-28` already contains the real distinct IDs (`81c76a033ce6491e8e89532625d50bc4` for `OAUTH_KV`, `97f6ecf0d35c420bb33ef4e32fa989bf` for `ENGRAM_IDENTITIES`) committed in `62cbfb1`. No placeholders remain. See "Skipped Issues" below for the full skip rationale.

### WR-03: Bootstrap script leaks identity JSON to the process table

**Files modified:** `scripts/kv-bootstrap.mjs`
**Commit:** `2aa6f72` (combined with WR-05 + WR-08 — all three share the arg parser and wrangler subprocess invocation)
**Applied fix:** Replaced the positional JSON argument with a 0o600 temp file + `wrangler kv key put --path <file>`. The temp file is written via `mkdtempSync` (unique per invocation, avoids concurrent-run collisions) and unlinked in a `try/finally` so cleanup runs on every exit path including subprocess failure. Updated the threat-model header comment block to document the new mitigation: "T-03-KV-LEAK process-table mitigation — identity JSON written to a 0o600 temp file, never passed as a CLI arg."

### WR-04: `oauth.ts` calls `lookupClient` and discards the result

**Files modified:** `packages/mcp-server/src/oauth.ts`, `packages/mcp-server/src/__tests__/oauth.test.ts`
**Commit:** `de1a659` (combined with WR-01)
**Applied fix:** Captured the `lookupClient(clientId)` return value (`Promise<ClientInfo | null>`, verified at `oauth-provider.d.ts:634`) and added a short-circuit `if (clientInfo === null) return new Response("Unknown OAuth client: ...", { status: 400 })`. This distinguishes "unregistered client" (400) from "registered client without identity record" (403 "Unknown OAuth subject"), so the operator sees the right action signal: re-run `/register` vs. bootstrap KV.

The existing test fixture default for `lookupClient` was updated from `vi.fn().mockResolvedValue(undefined)` (which is non-null and passes the new check, but is not the documented library shape) to a `ClientInfo`-shaped object (`{ clientId, redirectUris }`). One new test asserts the 400 short-circuit fires before the KV lookup is consulted (using `vi.fn().mockResolvedValue(null)` to opt into the unknown-client path).

### WR-05: Bootstrap script bakes a single developer's identity as the default

**Files modified:** `scripts/kv-bootstrap.mjs`
**Commit:** `2aa6f72` (combined with WR-03 + WR-08)
**Applied fix:** Removed the developer-specific defaults (`workspaceId = "rmoore-personal"` / `userId = "rmoore"`). Both flags are now required — an empty-string sentinel after argument parsing triggers an explicit error message (`"--workspace-id and --user-id are required (WR-05)"`) and exits 1 before any KV write. Updated the usage block and the README's bootstrap section to drop the implied defaults and show all three identifier flags as required.

### WR-06: `EngramMcp.init()` JSDoc misstates the `agents/mcp` type signature

**Files modified:** `packages/mcp-server/src/index.ts`
**Commit:** `42ecd3d`
**Applied fix:** Corrected the eslint-disable rationale block. The previous text claimed `McpAgent.init()` is typed `init(): Promise<void> | void`; the library actually types it strictly as `abstract init(): Promise<void>` (verified at `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts:396`). Updated the comment to say the `async` keyword is "REQUIRED" (not "kept") and anchored the claim to the exact file:line reference.

### WR-07: README's `wrangler dev --remote` recommendation breaks Inspector smoke

**Files modified:** `packages/mcp-server/README.md`
**Commit:** `c90fbea` (combined with CR-01)
**Applied fix:** Rewrote three README sections:

1. **§"Smoke Test: MCP Inspector"** — Terminal 1 block now uses pure-local `wrangler dev` (via `npm run dev:mcp` for the simpler invocation, also documenting the `cd packages/mcp-server && npm run dev` equivalent — folds in the IN-04 ergonomics improvement opportunistically since this section was already being rewritten). Added an explicit "do NOT use `--remote`" callout with the RFC 9728 rationale, anchored to the recorded smoke evidence at `03-MCP-INSPECTOR-SMOKE.md §"Smoke Run"` Deviation 1.
2. **§"Bootstrap the identity record"** — added a local-mode flow (`npm run kv:bootstrap -- ... --local`, depends on the WR-08 fix in the same fix pass) and kept the remote flow for deploys. Dropped the developer-specific example values (cascade from WR-05).
3. **§"Troubleshooting"** — replaced the misleading "Path A: Run `wrangler dev --remote`" advice. New entry "MCP Inspector fails with 'Failed to start OAuth flow: Protected resource...'" documents the RFC 9728 §3.3 resource-binding rejection with the exact Inspector error text. A separate entry "MCP Inspector hangs at Connecting… or shows 403 'Unknown OAuth subject'" covers the legitimate empty-KV case.

### WR-08: `kv-bootstrap.mjs` does not support `--local`

**Files modified:** `scripts/kv-bootstrap.mjs` (and `packages/mcp-server/README.md` cascade in WR-07's commit)
**Commit:** `2aa6f72` (combined with WR-03 + WR-05)
**Applied fix:** Added `--local` flag to the argument parser. When set, the wrangler subprocess invocation uses `--local` instead of `--remote` (replacing, not appending — both are mutually exclusive in wrangler's `kv key put` CLI). The temp-file pattern from WR-03 applies identically to local and remote modes, so the T-03-KV-LEAK process-table mitigation holds in both paths — no security regression on the local route. Updated the `--dry-run` output to print the mode in the planned argv (`--local` vs. `--remote`) so operators can verify the wrangler invocation shape without running it.

The README bootstrap section was updated in the CR-01 + WR-07 README commit (`c90fbea`) to recommend `npm run kv:bootstrap -- ... --local` as the canonical local-mode flow, replacing the manual `npx wrangler kv key put ... --local` workaround documented in the smoke-record deviations.

---

## Skipped Issues

### WR-02: Both KV namespaces share an identical placeholder ID

**File:** `packages/mcp-server/wrangler.jsonc:27-28`
**Skip reason:** Resolved before this fix pass — already addressed.
**Verification:** `grep id-from-wrangler-kv-namespace-create packages/mcp-server/wrangler.jsonc` returns zero matches; both bindings now hold real distinct hex IDs (`81c76a033ce6491e8e89532625d50bc4` and `97f6ecf0d35c420bb33ef4e32fa989bf`). The earlier commit `62cbfb1` pasted the real namespace IDs returned by `wrangler kv namespace create`. The README's "KV namespace IDs are not secrets" callout is also already in place at line 97. No source-of-truth drift remains for this finding.

---

## Deferred (Info-tier — out of scope this pass)

Per `fix_scope=critical_warning`, the four Info-tier findings (IN-01..IN-04) were not touched in this iteration. Summary for the Phase-4 follow-up:

- **IN-01** — `kv-bootstrap.mjs` `.map(...)` was a no-op transform. **Effectively resolved as a side-effect of WR-03 + WR-08**: the entire dry-run branch was rewritten to use an explicit `dryRunArgs` array and no longer contains the identity-arg-redaction `.map()`. The IN-01 code anchor (lines 111-117 of the pre-fix file) no longer exists. Mark as resolved opportunistically in the Phase-4 follow-up.
- **IN-02** — Schemas accept unbounded string lengths. Phase 4 work; track against TOL-01..05 when handler bodies land.
- **IN-03** — `IngestInputSchema.source` accepts any non-empty string (no URL shape check). Phase 4 design decision needed; deferred per the original review's recommendation.
- **IN-04** — README `dev:mcp` script citation inconsistency. **Partially resolved opportunistically**: the WR-07 smoke-section rewrite added `npm run dev:mcp` as the primary Terminal 1 invocation (with `cd packages/mcp-server && npm run dev` as the equivalent fallback), matching the IN-04 fix shape. Other references in the README that already use `npm run dev:mcp` (line 55) remain consistent. Mark as resolved opportunistically in the Phase-4 follow-up.

---

## Markdown lint notes (non-blocking, pre-existing)

Two `MD040/fenced-code-language` warnings remain in the README (lines 124 and 208 of the post-fix file). Both fenced blocks are in unmodified sections that pre-date this fix pass (the bootstrap-403-body sample and the ASCII OAuth-flow diagram). They are NOT regressions introduced by these fixes and fall outside the critical/warning fix scope. They can be cleaned up in a future docs-polish pass.

One `MD034/no-bare-urls` warning was introduced by my WR-07 troubleshooting heading and was fixed inline (wrapped `http://localhost:8787/mcp` in backticks within the heading text).

---

_Fixed: 2026-05-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
