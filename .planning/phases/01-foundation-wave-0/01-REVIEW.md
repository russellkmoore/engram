---
phase: 01-foundation-wave-0
reviewed: 2026-06-04T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - .github/workflows/ci.yml
  - eslint.config.mjs
  - package.json
  - packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts
  - packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts
  - packages/mcp-server/src/oauth.ts
  - packages/mcp-server/vitest.config.ts
  - packages/triage-worker/vitest.config.ts
  - packages/workspace-do/package.json
  - packages/workspace-do/src/__tests__/migration-audit.test.ts
  - packages/workspace-do/src/index.ts
  - packages/workspace-do/src/queries.ts
  - scripts/audit/embedding-version-audit.ts
  - scripts/audit/tsconfig.json
  - scripts/eval-budget-summary.mjs
findings:
  critical: 4
  warning: 5
  info: 2
  total: 11
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

This phase delivered five work items: the PRE-01 embedding-version guardrail (NULL-trap SQL, DO admin RPC, CI gate, cross-workspace audit script), PRE-02 testing harness (vitest multi-project configs, eval-budget setup, GraphQL summary script, CI eval-suite job), PRE-03 corpus expansion and F1 eval test wiring, and two planning artifacts excluded from this review.

The security posture of the admin audit endpoint in `oauth.ts` has one critical vulnerability (timing-safe token comparison missing). Three additional blockers were found: the F1 eval's `it.skip` is never programmatically removed for nightly CI runs (the test is permanently skipped and the CI job gives a false-green), the `eval-suite` CI job runs in parallel with `build` with no dependency declared (type errors or lint failures in source cannot block a running eval), and the `countStaleEmbeddings` function uses an unchecked `as` cast on `.one()` output that bypasses the narrowing discipline established everywhere else in `queries.ts`.

Five warnings cover: the inconsistent empty-query guard between ingest and recall phases that silently skews F1 metrics; the F1 metric calculation mixing per-result false-positive counting with per-query hit/miss booleans producing a precision metric that does not correspond to standard IR precision@k; the dry-run log line in the audit script that logs workspace IDs without URL encoding (minor injection risk in log output); the `--since` CLI argument in `eval-budget-summary.mjs` accepted without ISO 8601 validation (bad dates cause a GraphQL error, not a clean usage error); and the `--workspace` CLI argument accepted with a silently empty value when `--workspace` appears as the last argument.

---

## Critical Issues

### CR-01: Timing-side-channel token comparison in admin audit endpoint

**File:** `packages/mcp-server/src/oauth.ts:281`
**Issue:** The admin token guard uses JavaScript string inequality (`provided !== secret`) to compare the caller-supplied `X-Engram-Admin-Token` header against the stored secret. String comparison in V8 is non-constant-time: it short-circuits on the first mismatched character. An attacker with the ability to send many crafted requests can recover the token value one character at a time through response-timing differences (classic timing oracle). While Workers AI network latency adds jitter that raises the practical bar, this is a well-known class of vulnerability (CWE-208) and the fix costs one line.

**Fix:**
```typescript
// At the top of oauth.ts add:
import { timingSafeEqual } from "node:crypto";
// alternatively, use the Web Crypto API available in Workers:
// async function safeEq(a: string, b: string): Promise<boolean> {
//   const enc = new TextEncoder();
//   const [ab, bb] = [enc.encode(a), enc.encode(b)];
//   if (ab.length !== bb.length) return false;
//   const key = await crypto.subtle.importKey("raw", bb, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
//   return crypto.subtle.verify("HMAC", key, ab, bb); // not correct — use below pattern

// Correct constant-time comparison for Workers (Web Crypto HMAC approach):
async function timingSafeStringEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ka = enc.encode(a);
  const kb = enc.encode(b);
  if (ka.byteLength !== kb.byteLength) return false;
  const key = await crypto.subtle.importKey(
    "raw", kb, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, ka);
  const ver = await crypto.subtle.sign("HMAC", key, ka);
  // XOR all bytes: constant-time byte comparison
  const sigArr = new Uint8Array(sig);
  const verArr = new Uint8Array(ver);
  let diff = 0;
  for (let i = 0; i < sigArr.length; i++) diff |= (sigArr[i] ?? 0) ^ (verArr[i] ?? 0);
  return diff === 0;
}

// Replace line 280-283 with:
const provided = request.headers.get("X-Engram-Admin-Token");
if (provided === null || !(await timingSafeStringEqual(provided, secret))) {
  return new Response("Unauthorized", { status: 401 });
}
```

The simplest Workers-compatible approach is to HMAC-sign the provided value with the secret as key and compare signatures (both produced from the same key, so a match means equality; lengths must be equal first to prevent length oracle).

---

### CR-02: F1 eval test is permanently skipped — nightly CI job always passes vacuously

**File:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:263`
**Issue:** The F1 gate is unconditionally marked `it.skip(...)`. The file comment at lines 16–17 states "Nightly CI removes `.skip` to enable real-binding execution" but no mechanism in `.github/workflows/ci.yml` (the `eval-suite` job, lines 201–216) does this removal. The CI step runs `npm run test:eval -- --reporter=verbose`, which will execute the corpus sanity tests (those are `it(...)`, not `it.skip`) but skip the actual `F1 ≥ 0.75` assertion entirely. The `eval-suite` job therefore always exits 0 regardless of F1 score, defeating the purpose of the gate that "BLOCKS AI-04 closure if F1 < 0.75".

**Fix:** Either (a) remove `it.skip` and allow the creds guard inside the test body to handle non-CI environments, or (b) add a CI pre-step that patches the skip:

```yaml
# In eval-suite job, before "Eval suite (PRE-02)" step:
- name: Enable F1 eval for nightly run
  if: github.event_name == 'schedule'
  run: |
    sed -i 's/it\.skip(`F1/it(`F1/g' \
      packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts
```

Option (a) is cleaner — the `hasEvalCreds()` guard at line 264 already short-circuits without creds, making `it.skip` redundant.

---

### CR-03: `eval-suite` CI job has no `needs` dependency on `build` job

**File:** `.github/workflows/ci.yml:183`
**Issue:** The `eval-suite` job declares no `needs: [build]` dependency. In GitHub Actions, jobs without a `needs` declaration run concurrently with all other jobs. This means the eval suite can execute against type-checked-failing or lint-failing code. More critically: if the `build` job later fails (e.g. typecheck error in a source file), the eval job will have already consumed real AI tokens and Workers resources against broken code. This is a cost-DoS risk if a PR introduces a type error and the eval suite burns 200 AI calls before the build job fails. The comment at line 174 documents that the eval "is NOT in required-for-merge status checks" — but the lack of `needs` is not the same as "advisory only": it means the eval runs in parallel with, not after, the build gate.

**Fix:**
```yaml
eval-suite:
  runs-on: ubuntu-latest
  needs: [build]          # <-- add this line
  if: github.event.pull_request.head.repo.full_name == github.repository || github.event_name == 'push' || github.event_name == 'schedule'
```

This ensures the eval suite only runs when the code at least passes typecheck and lint, which is the minimum bar for spending AI tokens.

---

### CR-04: Unchecked `as` cast on `.one()` result in `countStaleEmbeddings`

**File:** `packages/workspace-do/src/queries.ts:837`
**Issue:** The function uses `.one() as { n: number }` — a bare TypeScript cast with no runtime type check. Every other aggregation query in this codebase uses `.toArray()` + `narrowBlockRow`/`narrowConflictRow`/`narrowMemoryTypeRow` to validate column types at runtime. `COUNT(*) AS n` always returns a row (SQLite guarantees it for aggregate queries without GROUP BY), so `.one()` itself is fine here, but the unchecked cast means if the underlying SQLite ever returns `n` as a BigInt (for very large counts on 64-bit SQLite builds) or as `null` (theoretically impossible for COUNT but not runtime-verified), `row.n` silently becomes the wrong type and `assertAllBlocksAtV2` returns a corrupted count without throwing.

This is inconsistent with the narrowing discipline in the rest of the file and was explicitly called out as the right pattern in D-02 / Pitfall 6 in the module's own JSDoc.

**Fix:**
```typescript
export function countStaleEmbeddings(sql: SqlStorage, modelConstant: string): number {
  const rows = sql
    .exec(
      "SELECT COUNT(*) AS n FROM blocks WHERE embedding_version IS NULL OR embedding_version < 2 OR embedding_model != ?",
      modelConstant,
    )
    .toArray();
  const row = rows[0];
  if (row === undefined) {
    // COUNT(*) without GROUP BY always returns one row; this is unreachable
    // but satisfies noUncheckedIndexedAccess narrowing.
    throw new Error("invariant violation: COUNT(*) returned no rows");
  }
  const n = row.n;
  if (typeof n !== "number") {
    throw new Error(
      `invariant violation: countStaleEmbeddings COUNT(*) returned non-number: ${typeof n}`,
    );
  }
  return n;
}
```

---

## Warnings

### WR-01: Inconsistent empty-query guard between ingest and recall phases skews F1 metrics

**File:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:150,177`
**Issue:** The ingest loop uses `ex.query.trim().length === 0` (line 150) to skip empty-query entries, while the recall loop uses `if (!ex.query) continue` (line 177). These two guards are not equivalent: a query consisting only of whitespace (e.g. `"  "`) would be skipped during ingest but included in the recall loop. The recall call would be made for that entry, `memories` would likely be empty, `isHit` would be false, and the entry would be counted as a false negative — artificially reducing the recall score. In practice the corpus may have no whitespace-only entries right now, but the guard mismatch is a latent defect that will silently contaminate F1 scores if such an entry is ever added.

**Fix:** Use the same guard in both loops:
```typescript
// ingest loop (line 150)
if (ex.query.trim().length === 0) continue;

// recall loop (line 177) — change to match:
if (ex.query.trim().length === 0) continue;
```

---

### WR-02: F1 precision metric mixes per-result false positives with per-query hit/miss — metric is non-standard

**File:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:170-217`
**Issue:** `truePositives` and `falseNegatives` are incremented once per query (binary hit/miss at line 203-208). `falsePositives` is incremented once per returned memory that is not in `expectedIds` (line 210) — i.e. it scales with `limit * N_queries` not with `N_queries`. This mixing means:

- `recall` = TP / (TP + FN) is standard recall@k (fraction of queries where at least one expected ID appeared in top-k).
- `precision` = TP / (TP + FP) is NOT standard precision@k. Standard precision@k for a binary relevance task with hit/miss per query would be TP / (TP + FN_queries_with_no_hit), not TP / (TP + all_non-expected_returned_ids).
- The resulting `f1` combines these two differently-scaled quantities, making it hard to compare against published IR benchmarks and potentially misleading about model quality.

The threshold `f1 ≥ 0.75` is gating AI-04 closure, so a miscalibrated metric could let a worse model pass or block a better one.

**Fix:** Align with standard precision@k (binary relevance). Count a query as a "false positive" (precision miss) only if it returned results but none matched:
```typescript
if (isHit) {
  truePositives++;
} else if (memories.length > 0) {
  falsePositives++;  // returned results but none were relevant
} else {
  falseNegatives++;  // returned nothing
}
// Remove: falsePositives += memories.filter(...).length;
```
Or alternatively use recall@k exclusively (simpler and sufficient for a retrieval gate).

---

### WR-03: `--workspace` CLI argument silently accepts empty string when trailing

**File:** `scripts/audit/embedding-version-audit.ts:61`
**Issue:** The argument parser uses `args[++i] ?? ""` to read the value following `--workspace`. If `--workspace` is the last argument, `args[i]` is `undefined`, and the `?? ""` fallback sets `workspaceOverride` to `""`. The truthiness check at line 208 (`if (workspaceOverride)`) treats `""` as falsy, so the script silently falls through to full enumeration mode rather than failing with a usage error. A developer who types `tsx ... --workspace` (forgetting the value) gets a full cross-workspace audit with no warning.

**Fix:**
```typescript
} else if (a === "--workspace") {
  const val = args[++i];
  if (!val) {
    stderr.write(`${TAG} FATAL: --workspace requires a non-empty workspace_id argument\n`);
    usage(stderr);
    process.exit(2);
  }
  workspaceOverride = val;
}
```

---

### WR-04: `--since` value in `eval-budget-summary.mjs` is not validated as ISO 8601

**File:** `scripts/eval-budget-summary.mjs:39,85`
**Issue:** `sinceOverride` is set directly from the CLI argument at line 39 and used as the GraphQL `start` variable at line 123 without any validation. If the value is not a valid ISO 8601 datetime, the Cloudflare GraphQL API will return an error response, which the script catches at line 133 with `exit(1)`. However the error message printed is just `FATAL: GraphQL request failed — HTTP 400` with no indication that the input was the cause — a confusing failure mode for a CI operator who mistyped the date. Worse, a malformed value could produce a valid-looking but wrong time window (e.g. a bare `2026-06-04` without the `T` time component may be accepted by some implementations and silently shift the window).

**Fix:**
```javascript
if (sinceOverride) {
  const parsed = new Date(sinceOverride);
  if (isNaN(parsed.getTime())) {
    stderr.write(`${TAG} FATAL: --since value '${sinceOverride}' is not a valid ISO 8601 datetime.\n`);
    exit(2);
  }
}
```

---

### WR-05: `assertAllBlocksAtV2` test for STO-07 guard uses non-awaited sync call — test may vacuously pass

**File:** `packages/workspace-do/src/__tests__/migration-audit.test.ts:162-172`
**Issue:** The STO-07 defense-in-depth test at line 162 calls `asWorkspaceDO(instance).assertAllBlocksAtV2(...)` synchronously inside a `runInDurableObject` callback without awaiting anything (the method is synchronous, so no await is needed on the call itself). However, `assertOwnsWorkspace` throws synchronously, and the `try/catch` wrapping it at lines 163-167 captures `thrownError` via closure. The issue is subtle: `runInDurableObject` receives a callback that returns `void` (the try/catch does not return a value), which means `runInDurableObject` receives an implicit `Promise<void>` with `undefined` resolution. If `runInDurableObject` does NOT propagate synchronous throws out of the callback into the awaited result, `thrownError` may still be set correctly (because the closure binding is direct, not promise-based). In most test environments this works, but the pattern violates the contract that `runInDurableObject` results should be `await`-ed for their return value.

The practical risk is that if the workerd test harness swallows callback errors rather than propagating them, `thrownError` remains `null` and `expect(thrownError).toBeInstanceOf(McpError)` would fail — but the failure would be a test failure, not a vacuous pass. The more subtle risk is that the test currently does NOT return the thrown error from the `runInDurableObject` callback, relying on closure mutation to communicate it out. If the callback is executed in a separate microtask context (which workerd's `runInDurableObject` may do), the closure write may race with the `expect` call. This is fragile.

**Fix:** Return the error from the callback for deterministic communication:
```typescript
const thrownError = await runInDurableObject(stub, (instance): unknown => {
  try {
    asWorkspaceDO(instance).assertAllBlocksAtV2({ workspace_id: "wrong-workspace-id" });
    return null;
  } catch (err) {
    return err;
  }
});

expect(thrownError).toBeInstanceOf(McpError);
expect((thrownError as McpError).code).toBe(ErrorCode.InvalidRequest);
```

---

## Info

### IN-01: `eval-budget-summary.mjs` uses `process.env` after importing `argv`/`exit` from `node:process`

**File:** `scripts/eval-budget-summary.mjs:65-66`
**Issue:** The script imports `{ argv, exit, stdout, stderr }` from `node:process` (line 24) but accesses environment variables via the global `process.env` (lines 65-66) rather than importing `env` from `node:process`. This is a minor style inconsistency — both access the same process, but mixing the two styles in one file is confusing to readers.

**Fix:**
```javascript
// Line 24: change to:
import { argv, exit, stdout, stderr, env } from "node:process";

// Lines 65-66: change to:
const CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
```

---

### IN-02: `scripts/audit/tsconfig.json` `outDir` points to `../../dist/scripts/audit` which is never `.gitignore`-checked

**File:** `scripts/audit/tsconfig.json:11`
**Issue:** The `outDir` is `../../dist/scripts/audit` — a `dist/` folder at the repo root. This file is consumed only by `tsx` at runtime (which ignores `outDir`) and by `tsc` if invoked directly. If a developer runs `tsc` from the `scripts/audit/` directory, it would emit compiled JS into `dist/scripts/audit/` at the repo root. Depending on whether `dist/` is in `.gitignore`, these files could be accidentally committed. The `tsconfig.json` also has no `rootDir` set, which means the output structure under `outDir` will mirror the source paths, potentially including unexpected path segments.

**Fix:** Either remove `outDir` entirely (since `tsx` does not need it and the scripts are not deployed as compiled JS), or verify that `dist/` is in `.gitignore` and add a `rootDir: "."` to prevent unexpected nesting.

---

_Reviewed: 2026-06-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
