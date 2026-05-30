# Phase 7: Deploy + Acceptance - Pattern Map

**Mapped:** 2026-05-29
**Files analyzed:** 4 (1 MAJOR EDIT, 1 EDIT, 1 POSSIBLE EDIT, 1 NEW)
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `README.md` (root, MAJOR EDIT) | docs (user-facing onboarding) | request-response (user reads → user acts) | `packages/mcp-server/README.md` (448 lines) | exact (same domain, same audience, deeper-but-aligned content already exists) |
| `package.json` (root, EDIT) | config (npm scripts) | batch (script chain → wrangler subprocess) | existing root `package.json` `scripts` block (`evals:ci`, `setup`, `predeploy`) | exact (extend the same file, same conventions) |
| `scripts/kv-bootstrap.mjs` (POSSIBLE EDIT — `--help` banner only; do NOT change arg shape) | utility (CLI script) | request-response (argv → stderr usage) | own existing `usage()` block (lines 48–59) + `scripts/lint-wrangler.mjs` exit-code conventions | exact (file already has the pattern — Phase 7 may only normalize the banner) |
| `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` (NEW) | docs (acceptance evidence) | request-response (Russell runs test → records result) | `.planning/phases/01-foundation/01-HUMAN-UAT.md` (45 lines) + `.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md` (130 lines, "## Smoke Run" subsection) | role-match (Phase 1 is the only true HUMAN-UAT; Phase 3 smoke-record contributes the post-run evidence pattern) |

---

## Pattern Assignments

### `README.md` (root) — MAJOR EDIT (docs, request-response)

**Analog:** `packages/mcp-server/README.md` — this is the load-bearing analog. Phase 3 over-delivered the per-package README (448 lines), and Phase 7's root-README delta per CONTEXT.md Claude's Discretion is "extract the user-facing 80% of that content to the root README per D-02's ordering, hoist + cross-link, NOT a from-scratch write." The Phase 3 README already contains: KV namespace creation, OAuth flow narrative, Claude Desktop config snippets (production + local), kv-bootstrap walkthrough, MCP Inspector smoke procedure, Troubleshooting section.

**Root README current structure** (verified via grep — file is 443 lines):

| Line | Section |
|------|---------|
| 13 | `## Why Engram` |
| 25 | `## Architecture` (mermaid diagram) |
| 79 | `## Tech Stack` |
| 95 | `## Status` |
| 105 | `## Getting Started` |
| 107 | `### Prerequisites` |
| 112 | `### Install and run` |
| 132 | `## Tool Surface (v0.1)` |
| 140 | `### remember` |
| 192 | `### recall` |
| 253 | `### search` |
| 292 | `### forget` |
| 334 | `### ingest` |
| 375 | `### Common envelope fields` |
| 389 | `### Token budget` |
| 409 | `### Error semantics` |
| 423 | `### Source of truth` |
| 435 | `## Architecture Deep Dive` |
| 441 | `## License` |

**Per-package README structure** (verified via grep — file is 448 lines):

| Line | Section |
|------|---------|
| 17 | `## Phase Status` |
| 32 | `## Prerequisites` |
| 49 | `## Local Development` |
| 71 | `## First-Time Setup (one-shot)` |
| 76 | `### Create KV namespaces` |
| 100 | `### No additional secrets required` |
| 110 | `### Bootstrap the identity record` |
| 173 | `## Claude Desktop Configuration` |
| 182 | `### Production (deployed to your own subdomain)` |
| 201 | `### Local development (against \`wrangler dev\`)` |
| 220 | `## OAuth Flow (under the hood)` |
| 258 | `## Smoke Test: MCP Inspector` |
| 341 | `## Troubleshooting` |

#### Phase 7 root README delta plan (per CONTEXT.md D-02 + D-08 + Claude's Discretion §"README structure")

**Pattern 1 — Hoist Step 4 (OAuth bootstrap inline in Getting Started).**

Source: `packages/mcp-server/README.md` lines 110–169 (`### Bootstrap the identity record`).

Insert AFTER line 128 of root README (after the `### Install and run` block ends) as new sibling subsections of `## Getting Started`. Existing root `## Getting Started` already has numbered structure (`### Prerequisites`, `### Install and run`), so adding `### Deploy` then `### Configure Claude Desktop` then `### Step 4: First tool call (expect the bootstrap step)` is a clean append — no restructure of existing subsections needed.

The new `### Step 4: First tool call` subsection MUST reference the literal 403 string emitted by `packages/mcp-server/src/oauth.ts:201`:

```
Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.
```

(verified via grep against `packages/mcp-server/src/oauth.ts` — the exact source line is `return new Response(\`Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.\`, { status: 403 });` at line 201 with the template literal closing on line 203.)

The walkthrough body copies from per-package README lines 110–169 with light editing for the "you just installed, here's what you're about to see" tone instead of the per-package "you're a developer iterating" tone. CONTEXT.md Claude's Discretion §"What goes in `npm run setup`'s final echo" forbids emojis (global directive).

**Pattern 2 — Insert "Deploy" section between `## Getting Started` and `## Tool Surface (v0.1)`.**

Source: CONTEXT.md D-08 + RESEARCH.md §"Pattern 1 (deploy via per-package workspace script)" + §"Pattern 2 (Cross-worker DO deploy order)".

Insert after line 128 (end of `### Install and run`) BEFORE the new Step 4 subsection, OR insert as new H2 `## Deploy` BEFORE `## Tool Surface (v0.1)` (line 132). CONTEXT.md D-08 calls it "a new Deploy section between 'Install and run' and 'Tool Surface'" — so insert as H2 at ~line 130, NOT as a subsection of Getting Started. This preserves the existing `## Getting Started` → `## Tool Surface (v0.1)` flow with `## Deploy` as the new H2 between them.

Content (per RESEARCH.md §"Code Examples" — verified against `packages/mcp-server/package.json:8` and `packages/triage-worker/package.json:8` which both already define `"deploy": "wrangler deploy"`):

- `npm run deploy` — runs the `predeploy` eval gate (already wired Phase 5 — `package.json:33` `"predeploy": "npm run evals:ci"`), then chains `deploy:mcp` then `deploy:triage` in that order (deploy-order matters per cross-worker DO `script_name` binding in `packages/triage-worker/wrangler.jsonc:20–22`).
- `npm run deploy:mcp` — per-package, skips the eval gate (npm only fires `pre<X>` for the literal script `X`, verified in RESEARCH Assumption A4).
- `npm run deploy:triage` — per-package, skips the eval gate. **Precondition note required:** `engram-mcp-server` must have been deployed at least once or wrangler fails on the cross-worker DO binding lookup.
- Eval-gate failure UX: per CONTEXT.md Claude's Discretion: "if `npm run deploy` fails at the eval gate, see `npm run evals:ci` output for details; fix the regressions before re-running deploy."

**Pattern 3 — Refresh Troubleshooting by hoisting P1–P6 SUMMARY.md "Deviations from Plan" sections.**

Source: 31 phase SUMMARY.md files (verified via grep — every plan summary across P1–P6 has a `## Deviations from Plan` section at consistent line offsets).

Mirror the per-package `## Troubleshooting` section structure (verified — `packages/mcp-server/README.md` lines 341–422 uses per-error H3 blocks: `### <error message>` → cause paragraph → fix code block). Example excerpt from the per-package README:

```markdown
### MCP Inspector hangs at "Connecting…" or shows 403 "Unknown OAuth subject"

The `ENGRAM_IDENTITIES` KV namespace (local-mode or remote, depending on
which `wrangler dev` mode you're in) has no entry for the Inspector's
dynamically-registered client id. Trigger one `/authorize` attempt to
surface the 403 body, copy the `sub` from the error, then run:

\`\`\`bash
npm run kv:bootstrap -- --sub <copied-sub> \
  --workspace-id <your-workspace-id> \
  --user-id <your-user-id> \
  --local   # omit for production KV (--remote wrangler dev path)
\`\`\`

Reconnect from the Inspector UI.
```

**Source mapping question (planner — see "Key Questions Answered" below):** the P1–P6 `## Deviations from Plan` sections are NOT a uniform programmatic-extraction shape. Each Deviation is structured as `**N. [Rule X - Category] Title**` with bullets `- Found during:`, `- Issue:`, `- Fix:`, `- Files modified:`, `- Commit:` (verified against `04-06-SUMMARY.md`, `06-04-SUMMARY.md`, `03-06-SUMMARY.md` — same shape across phases). This is consistent enough to scan but the planner / executor must triage which deviations are "user-facing common failure modes" (suitable for README Troubleshooting) vs "internal lint/process auto-fixes" (NOT suitable for README — readers don't care about eslint rule collisions). The Phase 3 smoke `03-MCP-INSPECTOR-SMOKE.md` lines 105–107 (`Deviations from README procedure`) are the gold-standard user-facing failure modes; promote those first.

The README Troubleshooting must NOT duplicate the bootstrap-403 walkthrough (per D-02 that lives INLINE in Step 4); Troubleshooting covers OTHER errors (network failures, wrangler config drift, KV ID misconfiguration per Pitfall 2, restart-vs-close per Pitfall 4, stale JWT per Pitfall 3, eval-gate flake per Pitfall 6).

**Cross-linking pattern (already established in per-package README):**

The per-package `packages/mcp-server/README.md` already cross-links into `.planning/phases/03-mcp-server-scaffold/*` artifacts and into `CLAUDE.md`. Root README's new sections should cross-link DOWN into per-package READMEs (deep technical detail) and SIDEWAYS into `CLAUDE.md` (architecture rationale). Do NOT cross-link into `.planning/` from the root README — that surface is internal-developer GSD workflow, not user-onboarding.

---

### `package.json` (root) — EDIT (config, batch data flow)

**Analog:** the file's own existing `scripts` block, lines 14–34.

**Current scripts** (verified — `package.json:14-34`):

```jsonc
{
  "scripts": {
    "prepare": "husky",
    "lint": "eslint .",
    "lint:wrangler": "node scripts/lint-wrangler.mjs",
    "lint:blockconcurrency": "node scripts/lint-blockconcurrency.mjs",
    "kv:bootstrap": "node scripts/kv-bootstrap.mjs",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc -b --noEmit",
    "types:gen": "npm run types:gen --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "dev:mcp": "npm run dev --workspace @engram/mcp-server",
    "dev:triage": "npm run dev --workspace @engram/triage-worker",
    "setup:queue": "bash scripts/setup-queue.sh",
    "setup:vectorize": "bash scripts/setup-vectorize.sh",
    "setup": "node -e \"console.log('Engram setup: see CONTRIBUTING.md for GSD plugin install steps.')\" && npm install && npm run types:gen && npm run setup:vectorize",
    "evals:vitest": "npm test --workspace=packages/mcp-server -- --run evals && npm test --workspace=packages/triage-worker -- --run evals",
    "evals:promptfoo": "npx promptfoo eval -c packages/triage-worker/evals/triage-extraction.promptfoo.yaml --threshold-pass-rate 95",
    "evals:ci": "npm run evals:vitest && npm run evals:promptfoo",
    "predeploy": "npm run evals:ci"
  }
}
```

**Pattern observations from existing block:**

1. **Workspace delegation pattern** (`dev:mcp`, `dev:triage`): use `npm run <script> --workspace <pkg-name>`. The new `deploy:mcp` / `deploy:triage` MUST follow this exact form (per RESEARCH §"Pattern 1" primary recommendation).
2. **Script chaining with `&&`** (`evals:ci`, `setup`): existing pattern uses bare `&&`. The new `deploy` wrapper follows the same pattern.
3. **`node -e` for printable messages** (existing `setup` opening): the new `setup` final echo uses the same `node -e \"console.log(...)\"` pattern. Escape backslashes for the JSON-string-inside-JSON shape (CONTEXT.md Claude's Discretion provides the literal text).
4. **`setup:queue` already exists** (line 27 — `"setup:queue": "bash scripts/setup-queue.sh"`) but is NOT chained into `setup` (line 29). Phase 7 D-07 is a one-line edit: insert `&& npm run setup:queue` between `npm run setup:vectorize` and the new final echo.
5. **`predeploy` hook is npm-native** — npm fires `pre<X>` ONLY for the literal script `X` (verified RESEARCH Assumption A4 against npm lifecycle docs). So `predeploy` fires before `npm run deploy` but NOT before `npm run deploy:mcp`. This IS the desired D-08 semantic.

**Pattern excerpt for the Phase 7 additions** (per RESEARCH §"Code Examples" lines 384–404):

```jsonc
{
  "scripts": {
    // ...existing scripts unchanged through line 32...

    // EXTEND setup (D-07): add setup:queue + final echo before the existing predeploy line
    "setup": "node -e \"console.log('Engram setup: see CONTRIBUTING.md for GSD plugin install steps.')\" && npm install && npm run types:gen && npm run setup:vectorize && npm run setup:queue && node -e \"console.log('\\n[OK] Setup complete.\\n  Next:  npm run deploy        # ships both Workers (runs eval gate first)\\n         see README Step 4      # OAuth bootstrap for Claude Desktop\\n')\"",

    // ...existing evals:vitest / evals:promptfoo / evals:ci / predeploy unchanged...

    // ADD per D-08: per-package commands skip the eval gate, wrapper enforces it
    "deploy:mcp":    "npm run deploy --workspace=@engram/mcp-server",
    "deploy:triage": "npm run deploy --workspace=@engram/triage-worker",
    "deploy":        "npm run deploy:mcp && npm run deploy:triage"
  }
}
```

**Note: deploy order in the wrapper is load-bearing.** `packages/triage-worker/wrangler.jsonc` binds `WORKSPACE` to `WorkspaceDO` with `script_name: "engram-mcp-server"` (verified via grep, lines 20–22). If the wrapper inverts the order (triage first), wrangler fails on the binding lookup because the script-name target doesn't exist yet. The wrapper MUST chain `deploy:mcp` before `deploy:triage`.

**Note: `setup` opening `node -e` snippet about CONTRIBUTING.md should stay as-is.** Removing it would be scope creep beyond D-07's "extend setup" mandate. Phase 7 only adds (`&& npm run setup:queue && node -e \"...\"`) to the chain.

---

### `scripts/kv-bootstrap.mjs` — POSSIBLE EDIT (utility, request-response)

**Analog:** the file's own existing `usage()` function (lines 48–59) and the broader `scripts/lint-wrangler.mjs` (60 lines verified — same exit-code conventions).

**Current usage banner pattern** (verified — `scripts/kv-bootstrap.mjs:48-59`):

```javascript
const TAG = "[kv:bootstrap]";

function usage(stream) {
  stream.write(
    `${TAG} usage: node scripts/kv-bootstrap.mjs --sub <oauth-sub> --workspace-id <id> --user-id <id> [--local] [--dry-run]\n` +
      `${TAG}   --sub:          REQUIRED. OAuth subject claim from first /authorize attempt.\n` +
      `${TAG}   --workspace-id: REQUIRED. Engram workspace id (no developer-specific default — WR-05).\n` +
      `${TAG}   --user-id:      REQUIRED. Engram user id (no developer-specific default — WR-05).\n` +
      `${TAG}   --local:        optional. Write to local-mode KV (.wrangler/state/v3/kv/) instead of remote (WR-08).\n` +
      `${TAG}   --dry-run:      optional. Print planned wrangler command WITHOUT executing it (identity JSON redacted).\n` +
      `${TAG}   --help:         print this usage and exit 1.\n` +
      `${TAG} Exit codes: 0 success | 1 missing arg / --help | 2 wrangler subprocess failed.\n`,
  );
}
```

**Pattern observations:**

1. **`--help` / `-h` ALREADY HANDLED** (lines 90–93 + 101–104). The flag triggers `usage(process.stderr)` and exits 1 — same convention as required-arg failure. Phase 7's "may add `--help` banner" instruction per CONTEXT.md Integration Points is essentially a no-op: the banner already exists.
2. **`TAG`-prefixed lines** keep usage output greppable; do not change.
3. **Stream choice:** `usage()` accepts a stream (currently always `process.stderr`); preserve.
4. **Exit code convention:** `0 success | 1 missing arg / --help | 2 wrangler subprocess failed` — matches `scripts/lint-wrangler.mjs:13` (`0 clean | 1 violation | 2 no files matched`). Do not change.

**If Phase 7 touches this file at all** (low probability per CONTEXT.md "POSSIBLE EDIT"):

- ONLY allowed edit: add a one-line `Discoverability:` hint to the existing usage banner pointing at root README Step 4 (e.g., `${TAG}   See: README.md §"Getting Started → Step 4" for the end-to-end bootstrap walkthrough.\n`). This is purely additive and preserves the existing greppable shape.
- DO NOT change `--sub`, `--workspace-id`, `--user-id`, `--local`, `--dry-run` argument shape (per CONTEXT.md Integration Points: "do NOT change arg shape").
- DO NOT change exit codes.
- DO NOT change the T-03-KV-LEAK redaction behavior (lines 121–152).
- DO NOT change the `--remote` default-when-`--local`-unset behavior (line 131).

**Phase 3 carry-forward:** `scripts/kv-bootstrap.mjs` was extended in Phase 3 CR-01 follow-up to add the `--local` flag (resolves Deviation 2 in `03-MCP-INSPECTOR-SMOKE.md:107`). The script is already correct as-shipped; Phase 7's edit is a discoverability nit, not a correctness change.

---

### `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` — NEW (docs, request-response)

**Analog A:** `.planning/phases/01-foundation/01-HUMAN-UAT.md` (45 lines — the only existing HUMAN-UAT.md in the repo).

**Frontmatter shape** (verified — `01-HUMAN-UAT.md:1-7`):

```yaml
---
status: partial          # one of: partial | resolved | passed
phase: 01-foundation     # phase slug
source: [01-VERIFICATION.md]  # the verification doc that enumerates tests
started: 2026-05-25T22:00:00Z
updated: 2026-05-25T22:00:00Z
---
```

**Body shape** (verified — `01-HUMAN-UAT.md:9-43`):

```markdown
## Current Test

[awaiting human testing]

## Tests

### 1. <test title>
expected: <one-sentence expected outcome with exact verifiable details>
result: [pending]   # or [pass] / [fail]

### 2. <next test title>
expected: ...
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
```

**Analog B:** `.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md` (130 lines, ESPECIALLY the post-run "## Smoke Run" subsection at lines 92–107). This is the gold-standard pattern for capturing post-run evidence with deviations.

**Post-run evidence pattern** (verified — `03-MCP-INSPECTOR-SMOKE.md:93-107`):

```markdown
## Smoke Run

- **Date:** 2026-05-26
- **Mode:** `wrangler dev` (pure local mode — see Deviation 1)
- **Observed OAuth `sub`:** `<value>` (resolves RESEARCH Open Question 3 — ...)
- **OAuth dance:** completed (after local KV bootstrap; see Deviation 2)
- **Tools listed:** 5 (`remember`, `recall`, `search`, `forget`, `ingest`) — exact count, exact names
- **Per-tool error shape (all verified by clicking each tool in Inspector):**
  - `remember` → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-01)`
  - ...
- **Deviations from README procedure** (both fold into CR-01 fix queue):
  1. **<deviation title>.** <body, multiple sentences, concrete and verbose>
  2. **<deviation title>.** <body>
```

#### Phase 7 HUMAN-UAT.md target shape (merging Analog A + Analog B per CONTEXT.md D-04)

Use Analog A's frontmatter shape but pin `source: []` to the Phase 7 acceptance criteria (REQUIREMENTS.md DEP-03 + DEP-04) — Phase 7 has no separate `07-VERIFICATION.md`, so cite REQUIREMENTS.md DEP-IDs directly.

Use Analog A's `## Tests` section but the test entries follow Analog B's richer post-run shape because DEP-03 + DEP-04 capture more evidence than a binary pass/fail (URLs, wait durations, conv excerpts, deviations).

**Resulting frontmatter** (per RESEARCH §"Code Examples" lines 451–456):

```yaml
---
phase: 07
status: in_progress  # → "passed" when both runs + rewire smoke pass
captured_by: russell
---
```

Note: CONTEXT.md D-04 + RESEARCH frontmatter uses bare `phase: 07` (numeric-style); Analog A uses `phase: 01-foundation` (slug-style). Either works; the planner should pick ONE and stay consistent. Recommend the slug form (`phase: 07-deploy-acceptance`) to match Analog A's precedent — `/gsd:audit-uat` may glob/match on the slug shape.

**Test entry shape per RESEARCH lines 458–489** (three test entries — DEP-03 Run 1, DEP-03 Run 2, DEP-04 rewire smoke):

```markdown
## DEP-03: Cross-conversation recall

### Run 1: <date>
- **Expected:** `recall("...")` in a fresh Claude Desktop chat returns the job posting
  (URL + company + role) `remember()`'d 1+ hour earlier in a separate chat.
- **Job posting used (conv A):** <URL + role>
- **Wait duration:** <minutes>
- **Result:** <pending | pass | fail>
- **Conv A excerpt:** <paste verbatim — but REDACT any OAuth `sub` if visible>
- **Conv B excerpt:** <paste verbatim — same redaction rule>
- **Notes:** <any deviations>

### Run 2: <date+1>
- (same shape with a DIFFERENT job posting per D-03)

## DEP-04: Job-search agent rewire smoke

### Rewire smoke: <date>
- (per D-06 protocol — single end-to-end smoke entry)
```

**Security note (per RESEARCH §"Security Domain" Known Threat 3):** the HUMAN-UAT template MUST direct the operator to redact `<sub>` if pasted in conv excerpts. The Phase 1 HUMAN-UAT.md doesn't have this concern (Phase 1 tests are README portfolio checks); the Phase 7 template inherits Phase 3's smoke-record pattern (`03-MCP-INSPECTOR-SMOKE.md` recorded a `sub` value in plain text — `rJkmmoWYMRb5fW6Q` at line 96 — but the `sub` IS public per the OAuth flow design, so this is informational rather than blocking; the redaction guidance is precautionary).

**File creation timing:** per CONTEXT.md Integration Points, this file is `NEW (created at acceptance test time)` — NOT at plan time. The planner's plan for Phase 7 should specify the template shape (above) but the file gets written at execute time when Russell starts Run 1.

---

## Shared Patterns

### Pattern: npm script convention (workspace delegation + chained `&&`)
**Source:** `package.json:25-26` (existing `dev:mcp` / `dev:triage`) + `package.json:32` (`evals:ci` chain).
**Apply to:** all new scripts in `package.json` (D-07 + D-08).
```jsonc
// Workspace delegation:
"dev:mcp": "npm run dev --workspace @engram/mcp-server"
// Chained subprocess invocations:
"evals:ci": "npm run evals:vitest && npm run evals:promptfoo"
```
The Phase 7 additions (`deploy:mcp`, `deploy:triage`, `deploy`, extended `setup`) follow both conventions verbatim.

### Pattern: CLI script usage banner + exit codes
**Source:** `scripts/kv-bootstrap.mjs:48-59` (usage function) + `scripts/lint-wrangler.mjs:13` (exit code comment) + `scripts/lint-wrangler.mjs:43-47` (canary error).
**Apply to:** any new flag added to `scripts/kv-bootstrap.mjs` (if Phase 7 edits it at all).
```javascript
// Tag-prefixed greppable line, stream-parameterized writer, `0 success | 1 arg-error | 2 subprocess-fail` exit codes.
const TAG = "[kv:bootstrap]";
function usage(stream) {
  stream.write(
    `${TAG} usage: node scripts/kv-bootstrap.mjs ...flag-summary...\n` +
    `${TAG}   --flag: REQUIRED. <description>.\n` +
    `${TAG} Exit codes: 0 success | 1 missing arg / --help | 2 wrangler subprocess failed.\n`,
  );
}
```

### Pattern: README cross-linking depth
**Source:** `packages/mcp-server/README.md:424-447` (Architecture Reference section).
**Apply to:** root README's new sections.

The per-package README cross-links DOWN into `.planning/phases/03-mcp-server-scaffold/*` for design-time detail. Root README is one level shallower — it cross-links DOWN into per-package READMEs (Phase-implementation detail) and SIDEWAYS into `CLAUDE.md` (architecture rationale). Do NOT cross-link from root README into `.planning/` (internal GSD surface).

Example excerpt of the cross-link tone (from per-package `packages/mcp-server/README.md:425-432`):
```markdown
## Architecture Reference

- [`../../CLAUDE.md`](../../CLAUDE.md) §"Session DO vs Workspace DO" — the
  two-DO topology this Worker hosts ...
- [`../../.planning/REQUIREMENTS.md`](../../.planning/REQUIREMENTS.md)
  §"MCP Server (MCP)" — the MCP-01..09 requirement set ...
```

Adapted for root README context (DOWN-links):
```markdown
## Reference

- [`packages/mcp-server/README.md`](./packages/mcp-server/README.md) §"First-Time Setup" — full KV namespace creation procedure.
- [`packages/mcp-server/README.md`](./packages/mcp-server/README.md) §"Smoke Test: MCP Inspector" — pre-OAuth Worker liveness check.
- [`CLAUDE.md`](./CLAUDE.md) §"MCP Tool Surface" — the 5-tool design rationale.
```

### Pattern: Literal-string preservation (oauth.ts 403 body)
**Source:** `packages/mcp-server/src/oauth.ts:201` (the literal 403 body).
**Apply to:** README Step 4 walkthrough (per CONTEXT.md `<canonical_refs>` "do NOT change the error string in oauth.ts during Phase 7 — the README references it verbatim").

The source-of-truth string is:
```
Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.
```

Where `${sub}` is interpolated at runtime. The README MUST quote this string verbatim (with `<some-long-string>` or similar placeholder for the runtime-interpolated `${sub}` value) so users searching for the error message find the README walkthrough by exact match.

### Pattern: HUMAN-UAT.md gap-closure flow
**Source:** `01-HUMAN-UAT.md:36-43` (Summary block) — `/gsd:audit-uat` consumes the Summary block to compute phase-close eligibility. If any test is `pending` or `fail`, the phase is open.
**Apply to:** `07-HUMAN-UAT.md`.

The phase MUST NOT close until Summary shows `passed: 3, pending: 0, fail: 0` (Run 1 + Run 2 + DEP-04 rewire smoke). Per CONTEXT.md `<specifics>`: "There's no 'phase-passes-with-known-issues' escape hatch for DEP-03 — if recall returns wrong/missing fields in conv B, that's a gap-closure cycle."

---

## No Analog Found

None. All four files have at least one strong analog in the repo (`packages/mcp-server/README.md` for the root README; the existing `scripts` block for `package.json`; the script's own `usage()` for `kv-bootstrap.mjs`; the Phase 1 HUMAN-UAT + Phase 3 smoke record for the new HUMAN-UAT).

---

## Key Pattern-Mapping Questions Answered

**Q1: Does the existing root `README.md` "Getting Started" already have numbered steps?**

A: No — it has TWO unnumbered subsections (`### Prerequisites`, `### Install and run`). The current shape is procedural-but-unnumbered. Phase 7's "Step 4" naming per D-02 implies steps 1–3 also need explicit numbering. The clean approach:

- Restructure `## Getting Started` to use numbered H3s: `### 1. Install`, `### 2. Deploy`, `### 3. Configure Claude Desktop`, `### 4. First tool call (the OAuth bootstrap)`.
- Move existing `### Install and run` content under `### 1. Install`.
- Move existing `### Prerequisites` to a sub-block within `### 1. Install` OR keep it as an unnumbered preamble before `### 1.` (planner picks).

Note: D-02 calls Step 2 "deploy both Workers" and CONTEXT.md Claude's Discretion describes the Deploy section as a separate H2 between Getting Started and Tool Surface. Reconciliation: keep `### 2. Deploy` as a short H3 inside Getting Started that points at the H2 `## Deploy` section for the full reference. The H3 is the linear walkthrough; the H2 is the complete reference. Same pattern the per-package README uses for "First-Time Setup" (H2 narrative) vs "Troubleshooting" (H2 reference).

**Q2: Does `packages/mcp-server/README.md` Troubleshooting section have a fixed structure that can be mirrored?**

A: Yes — verified via grep (5 entries from line 341–422). Each entry is:
```
### <error message / symptom — usually a quoted error>
<one-paragraph cause explanation>
<optional: fix code block>
<optional: cross-reference back to a deeper section>
```
The root README's new Troubleshooting subsection mirrors this exactly. The 5 existing per-package entries are:
1. `### wrangler deploy fails with "class not declared in any migration"`
2. `### MCP Inspector fails with "Failed to start OAuth flow: Protected resource ... does not match expected http://localhost:8787/mcp"`
3. `### MCP Inspector hangs at "Connecting…" or shows 403 "Unknown OAuth subject"`
4. `### curl /health works but /mcp returns 401`
5. `### npm install fails with engine constraint complaints`
6. `### Inspector shows "Stream closed" or "Transport error" mid-session`

For the root README, drop the per-package-specific ones (#2, #6 — Inspector-internals) and promote a different set sourced from the P1–P6 SUMMARY.md deviations (planner triages). Root README Troubleshooting candidates:
- KV namespace IDs are still placeholders (Pitfall 2 from RESEARCH)
- Cached `~/.mcp-auth/` JWT (Pitfall 3)
- Closed-vs-quit Claude Desktop (Pitfall 4)
- Eval gate flaked on deploy (Pitfall 6)

The 403 "Unknown OAuth subject" entry does NOT go in Troubleshooting (per D-02 — it's INLINE in Getting Started Step 4).

**Q3: Are the P1–P6 SUMMARY.md "Deviations from Plan" sections in a consistent shape that can be programmatically collected?**

A: Partially. The H2 anchor is consistent (`## Deviations from Plan` — verified across 31 SUMMARY.md files). The body shape uses bullet sub-items but the categories vary (`[Rule 1 - Bug]`, `[Rule 3 - Blocking]`, `[Process]`, etc.) and most entries are INTERNAL refactor / lint / test-helper issues that are NOT user-facing common failure modes (e.g., "eslint non-null-assertion rule collision" from `06-04-SUMMARY.md`).

**The planner / executor must MANUALLY triage which deviations belong in the root README's user-facing Troubleshooting.** Programmatic collection would dump too much noise. The Phase 3 smoke `03-MCP-INSPECTOR-SMOKE.md:105-107` Deviations 1 + 2 are the gold-standard user-facing failure modes (README guidance + script flag missing) — those are exactly the shape that belong in user-facing Troubleshooting. Most other phase Deviations are internal-development noise.

Recommend the executor read each phase's `## Deviations from Plan` section and triage to a max of 4–6 user-facing entries for the root README. RESEARCH.md §"Common Pitfalls" lines 332–378 already enumerates the candidate user-facing failure modes (Pitfalls 1–8); the executor cross-references this list against the SUMMARY.md deviations rather than re-discovering them.

**Q4: Does any prior phase have a HUMAN-UAT.md to use as a template?**

A: Yes — `.planning/phases/01-foundation/01-HUMAN-UAT.md` (45 lines). Use it for the frontmatter shape + the `## Tests` / `## Summary` outer structure. Use `03-MCP-INSPECTOR-SMOKE.md:92-107` for the per-test post-run evidence shape (richer than Phase 1's flat `expected/result` because DEP-03/DEP-04 capture URLs, wait durations, conv excerpts, deviations).

The merged shape is documented under "Pattern Assignments → 07-HUMAN-UAT.md" above.

---

## Metadata

**Analog search scope:**
- `/Users/rmoore/Workspaces/engram/README.md` (root)
- `/Users/rmoore/Workspaces/engram/package.json` (root)
- `/Users/rmoore/Workspaces/engram/packages/mcp-server/README.md`
- `/Users/rmoore/Workspaces/engram/packages/mcp-server/package.json`
- `/Users/rmoore/Workspaces/engram/packages/triage-worker/package.json`
- `/Users/rmoore/Workspaces/engram/packages/mcp-server/src/oauth.ts` (lines 190–215, the 403 body)
- `/Users/rmoore/Workspaces/engram/packages/triage-worker/wrangler.jsonc` (cross-worker DO binding)
- `/Users/rmoore/Workspaces/engram/scripts/kv-bootstrap.mjs`
- `/Users/rmoore/Workspaces/engram/scripts/lint-wrangler.mjs` (exit-code convention)
- `/Users/rmoore/Workspaces/engram/.planning/phases/01-foundation/01-HUMAN-UAT.md`
- `/Users/rmoore/Workspaces/engram/.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md`
- `/Users/rmoore/Workspaces/engram/.planning/phases/{01..06}/**-SUMMARY.md` (31 files — Deviations shape probe)
- `/Users/rmoore/Workspaces/engram/.planning/phases/05-ai-integration/05-07-SUMMARY.md` + `06-04-SUMMARY.md` + `03-06-SUMMARY.md` (Deviations body shape verification)

**Files scanned:** ~14 source files + 31 SUMMARY.md headers (grep-based).
**Pattern extraction date:** 2026-05-29
