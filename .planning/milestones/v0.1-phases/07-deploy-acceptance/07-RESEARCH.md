# Phase 7: Deploy + Acceptance - Research

**Researched:** 2026-05-29
**Domain:** Cloudflare Workers production deploy + Claude Desktop MCP bridge + README authoring + HUMAN-UAT acceptance
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**OAuth bootstrap UX (DEP-02)**
- **D-01:** Ship the manual paste-the-sub flow for v0.1; document the v0.4 interactive bootstrap as deferred. The existing `oauth.ts` flow is the surface: `mcp-remote` registers → `/authorize` returns 403 with the literal body `Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.` → user copies `<sub>` → runs `npm run kv:bootstrap -- --sub <sub> --workspace-id <id> --user-id <id>` → retries in Claude Desktop.
- **D-02:** README places the bootstrap flow INLINE in Getting Started as Step 4, not in Troubleshooting. Ordering: (1) install + setup, (2) deploy both Workers, (3) configure Claude Desktop with `mcp-remote` URL, (4) first tool call — expect the bootstrap error, here's what to do. Troubleshooting section still exists for OTHER errors.

**Acceptance test protocol (DEP-03)**
- **D-03:** Two REAL 1-hour runs over a 1-2 day window — no fast-forward, no "imagine time passed." Run 1: remember in conv A → wait 1+ hour real wall-clock → recall in conv B. Run 2 next day with a DIFFERENT job posting (different role/company/URL — exercises Vectorize semantic recall, not memoization).
- **D-04:** Evidence captured as `07-HUMAN-UAT.md` (standard GSD HUMAN-UAT pattern). Each run is a test entry: `### Run 1: {date}` with expected/result/notes. Phase verification reads this file as DEP-03 evidence.

**Job-search agent rewire scope (DEP-04)**
- **D-05:** NO migration of existing job-search agent data. Pre-Engram local files (markdown, JSON, XLS) stay untouched on disk as historical record. DEP-04 work is exclusively forward-looking: rewire CAPTURE path + recall path to call Engram's MCP tools going forward.
- **D-06:** Regression verification = single-capture smoke test, captured as a HUMAN-UAT entry alongside the DEP-03 entries. Protocol: paste fresh job posting → agent calls `remember()` → verify via `recall()` in same conv → next day, fresh conv, ask "what jobs have I saved?" → verify capture returned with extracted fields.

**Setup automation completeness (DEP-01 + DEP-05)**
- **D-07:** Extend `npm run setup` to `install + types:gen + setup:vectorize + setup:queue + deploy-hint`. Currently runs `install + types:gen + setup:vectorize` only. Add `setup:queue` (idempotent — Phase 6 script). Add final `echo` printing: `"Setup complete. Run 'npm run deploy' to ship both Workers, then see README Step 4 for the OAuth bootstrap."` Do NOT include `kv:bootstrap` in `setup` (bootstrap requires a deployed Worker + a real `sub` neither of which exists at setup time).
- **D-08:** Add `npm run deploy` wrapper + per-package `deploy:mcp` / `deploy:triage` for surgical re-deploys. Wrapper: `predeploy` (runs `evals:ci`) → `wrangler deploy` for mcp-server → `wrangler deploy` for triage-worker. Per-package commands skip the evals gate — they're for day-N surgical re-deploys.

### Claude's Discretion

- **Wrangler deploy invocation shape.** Either `npm run deploy --workspace=@engram/mcp-server` (workspace-script form) or `cd packages/mcp-server && npx wrangler deploy` (explicit form). Planner picks.
- **Eval gate failure UX.** `predeploy` runs `evals:ci`. On failure, `npm run deploy` aborts. Document in README: "if `npm run deploy` fails at the eval gate, see `npm run evals:ci` output."
- **Two real Workers, one Cloudflare account, one workspace (v0.1).** No `--env dev` vs `--env prod` separation. v0.3 introduces env separation.
- **mcp-remote pinning.** Document currently-tested version in README config snippet with a dated comment. Don't hard-pin in code. v0.4+ may drop mcp-remote when Claude Desktop ships native Streamable HTTP.
- **README structure additions.** ~100–150 lines total: Getting Started Step 4 (~40 lines), new "Deploy" section between "Install and run" and "Tool Surface" (~30 lines), Troubleshooting refresh (~20–40 lines). Planner refines.
- **Test infrastructure.** No new test infra. Phase 7's verification is HUMAN-UAT-driven plus the deploy gate's existing eval suite.
- **Inline `[route]` tracker fires during execute-phase.** Expected 0–2 cf-code-assist routes (README content most likely `generateDocs` candidate).

### Deferred Ideas (OUT OF SCOPE)

- **v0.4 interactive `kv:bootstrap-interactive` script** (per D-01)
- **v0.3+ migration of pre-Engram job history** (per D-05)
- **`--env dev` vs `--env prod` separation** (v0.3)
- **Drop `mcp-remote` for native Streamable HTTP** (v0.4+ rollback marker)
- **CI/CD pipeline** (Phase 7 ships `npm run deploy` as manual command)
- **Monitoring dashboards** (Workers Analytics Engine writes are wired Phase 5/6; built-in observability is v0.1 surface)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEP-01 | `wrangler deploy` succeeds for `packages/mcp-server/` and `packages/triage-worker/` against Russell's Cloudflare account; both Workers live at `*.workers.dev` URLs | §"Wrangler Deploy Mechanics" + §"Cross-Worker DO Deploy Order" — per-package `deploy` scripts already exist; deploy order matters because of `script_name` cross-worker DO binding |
| DEP-02 | A JWT for Russell's single workspace is issued (script or doc), pasted into Claude Desktop's MCP config via `mcp-remote` bridge; connection verified by listing 5 Engram tools | §"mcp-remote Bridge State" + §"Claude Desktop Config Surface" — `mcp-remote@0.1.38` (verified [VERIFIED: npm registry + slopcheck]) still the canonical bridge per Cloudflare's own official docs; `claude_desktop_config.json` still supported alongside the newer "Custom Connectors" UI path |
| DEP-03 | Acceptance test: remember in conv A → 1+ hour wait → recall in conv B; passes ≥2 consecutive runs | §"Vectorize Indexing Settle Time" + §"Claude Desktop Conversation Boundary" — Vectorize eventual consistency is "a few seconds" (well under the 1-hour wait); the real risk surfaces are session-DO state crossing conversations and embedding namespace correctness, both already verified Phase 5 |
| DEP-04 | Russell's job-search agent reconfigured to use Engram as memory backend; agent's existing flow continues end-to-end (no regression) | §"Job-Search Agent Rewire Pattern" — per D-05 NO migration. Pattern is forward-only: agent's MCP client config points at Engram's `/mcp`; capture path swap; one HUMAN-UAT smoke entry |
| DEP-05 | Setup README documents prereqs, one-command bootstrap, Claude Desktop config snippet, troubleshooting for common errors observed in P1–P6 | §"README Structure for MCP Servers" + §"P1–P6 Common Errors Catalog" — most content already exists in `packages/mcp-server/README.md` (396 lines); Phase 7 is a root-`README.md` amendment + sync, not a from-scratch write |
</phase_requirements>

## Summary

Phase 7 is overwhelmingly **operational + documentation**, not architectural. The Workers, OAuth flow, KV bootstrap, eval gate, and per-package `deploy` scripts all already exist. Phase 7 wires them into three user-facing surfaces: (1) a root-level `npm run deploy` wrapper and amended `npm run setup`, (2) an extended root `README.md` with a Getting Started Step 4 OAuth bootstrap walkthrough and a new Deploy section, (3) a `07-HUMAN-UAT.md` evidence file for DEP-03 + DEP-04 acceptance.

The headline external risk — that **Claude Desktop has deprecated `claude_desktop_config.json` for remote MCP servers in favor of the Settings UI Custom Connectors path** — turns out to be a non-issue for Engram: both paths work in 2026, Cloudflare's own official docs explicitly recommend the `mcp-remote` + `claude_desktop_config.json` pattern Engram is built on, and `mcp-remote@0.1.38` (last published 2026-02-05) is alive and well [VERIFIED: npm registry + slopcheck]. The Custom Connectors UI path is the newer recommended option for non-technical users; the config-file + `mcp-remote` path remains the recommended option for developers / self-hosters — which is exactly Russell + Devon.

The headline internal risk is the **cross-worker Durable Object binding order**: `packages/triage-worker/wrangler.jsonc` binds `WORKSPACE` to `WorkspaceDO` with `script_name: "engram-mcp-server"`, meaning the mcp-server Worker MUST be deployed first or the triage-worker deploy fails with a binding-resolution error [CITED: developers.cloudflare.com/durable-objects/reference/environments/]. The `npm run deploy` wrapper must encode this order; the per-package `deploy:triage` command must document the precondition.

**Primary recommendation:** Take the per-package `npm run --workspace=<pkg> deploy` invocation form (workspace-script delegation) rather than `cd ... && npx wrangler deploy`. Each package already exposes a `deploy` script; the workspace form is shorter, idiomatic, and reuses the existing `wrangler deploy` invocation each package already declares. The root `npm run deploy` wrapper becomes a 3-line chain: `npm run predeploy && npm run deploy:mcp && npm run deploy:triage`. README documents all three.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Worker bundling + edge deploy | Wrangler (devDep) | Cloudflare control plane | `wrangler deploy` reads each package's `wrangler.jsonc` and pushes to Russell's `*.workers.dev` subdomain |
| OAuth provider + JWT minting | `@cloudflare/workers-oauth-provider` library inside mcp-server Worker | KV (OAUTH_KV grants + ENGRAM_IDENTITIES bootstrap lookup) | Library owns the standard endpoints; Engram owns the KV-backed identity lookup |
| MCP transport bridge (stdio ↔ Streamable HTTP) | `mcp-remote` npm package, run via `npx` from Claude Desktop's `command` field | Claude Desktop launches it as a subprocess | Per CONTEXT.md D-01, the bridge is community-maintained; the bridge runs locally on Russell's machine and proxies to the deployed Worker |
| Acceptance test orchestration | Russell (manual, two-day window) | `07-HUMAN-UAT.md` as evidence record | DEP-03 + DEP-04 are intentionally human-driven — D-03 rules out "imagine time passed" automation |
| Eval gate | npm `predeploy` script chain → vitest evals + promptfoo (already wired Phase 5) | `package.json` script wiring | Pre-existing; Phase 7 inherits via `predeploy` hook on the new `deploy` wrapper |
| Setup automation | npm `setup` script → shell scripts (`setup-vectorize.sh`, `setup-queue.sh`) | `wrangler vectorize/queues create` (idempotent) | Per D-07, extended once to chain `setup:queue` and emit a deploy hint |
| Documentation surface | Root `README.md` (user-facing) + `packages/mcp-server/README.md` (developer-facing) | `CONTRIBUTING.md` (1-paragraph stub today) | Per D-02, the OAuth bootstrap walkthrough lives INLINE in root README Getting Started, not buried in Troubleshooting |
| Job-search agent rewire | External — Russell's agent codebase (outside this repo) | Engram's `/mcp` endpoint as the MCP server target | DEP-04 is a config swap on the agent side; no code change in this repo per D-05/D-06 |

## Standard Stack

### Core (already installed — Phase 7 ships zero new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wrangler` | `^4.94.0` declared, **`4.95.0` latest** (verified `npm view wrangler version` 2026-05-29, published 2026-05-26) [VERIFIED: npm registry + slopcheck] | Cloudflare Workers deploy CLI | The only first-party tool for Cloudflare Workers deploy; required for queue / vectorize / KV / DO provisioning the project already uses |
| `mcp-remote` | **`0.1.38` latest** (verified `npm view mcp-remote version` 2026-05-29, published 2026-02-05) [VERIFIED: npm registry + slopcheck] | stdio ↔ remote-HTTP MCP bridge | Cloudflare's official `developers.cloudflare.com/agents/guides/test-remote-mcp-server/` docs use this exact package and invocation [CITED]. `claude_desktop_config.json` config surface for any client that doesn't speak Streamable HTTP natively. |
| `@cloudflare/workers-oauth-provider` | `0.7.0` (pinned, mcp-server `package.json`) [VERIFIED: existing dep] | OAuth 2.1 endpoints on the Worker | Library owns `/token`, `/jwks`, `/register`, `/.well-known/*`. defaultHandler owns `/authorize` (KV-backed identity), `/`, `/health`. No change in Phase 7. |
| `@modelcontextprotocol/inspector` | latest via `npx` (no version pin) | MCP smoke-test client | Used in Phase 3 as the per-package smoke; Phase 7 uses it again as the "did the deploy actually work" pre-OAuth check |

### Supporting (already installed — Phase 7 uses them as-is)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `^4.1.7` | Test runner | Already wired into `evals:ci` gate; Phase 7 doesn't add tests |
| `promptfoo` | `^0.121.13` | LLM eval harness | Already wired into `evals:ci`; Phase 7 doesn't add evals |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `claude_desktop_config.json` + `mcp-remote` | Claude Desktop "Settings → Connectors → Add custom connector" UI path | UI path is newer (2026 recommended for non-developer users), works for any MCP-compatible client over OAuth. Config-file path is documentable, reproducible, version-controllable, and what Cloudflare's own docs recommend for developer setups [CITED: support.claude.com/en/articles/11175166]. **Keep config-file path for Russell + Devon per CONTEXT.md alignment with existing `packages/mcp-server/README.md` content.** |
| `wrangler deploy` from each package directory | Turborepo / Nx orchestrated deploy | Engram does not use a monorepo orchestrator; npm workspaces is the established pattern from Phase 1. The 2-package deploy doesn't justify adding Turbo. |
| Manual two-step deploy (`deploy:mcp` then `deploy:triage`) | Single combined script | D-08 wants BOTH: the wrapper for day-1 ("ship both, evals first"), per-package for day-N ("just rebuild triage, mcp is fine"). Keep all three commands. |
| `--env production` | Single-env deploy | Per CONTEXT.md Claude's Discretion — v0.1 is single-env single-workspace single-user. v0.3 introduces env separation. |

**Installation:** None. All required deps are present.

**Version verification (executed 2026-05-29):**
```bash
$ npm view wrangler version              # → 4.95.0 (published 2026-05-26)
$ npm view mcp-remote version            # → 0.1.38 (published 2026-02-05)
$ npm view mcp-remote scripts.postinstall # → (empty — no postinstall hook)
$ npm view mcp-remote dependencies        # → express^4.21.2, open^10.1.0,
                                          #   strict-url-sanitise^0.0.1, undici^7.12.0
```

## Package Legitimacy Audit

> Phase 7 installs **zero new packages**. The audit below is for the packages the README + deploy flow REFERENCES (Russell will invoke them via `npx`), not for new `npm install` operations.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `wrangler` | npm | 5+ yrs (Cloudflare-maintained) | 800K+/wk | github.com/cloudflare/workers-sdk | `[OK]` | Approved (pre-existing devDep — Phase 1) |
| `mcp-remote` | npm | ~2 yrs (`0.1.x` series since 2024) | mid-thousands/wk (community bridge) | github.com/geelen/mcp-remote | `[OK]` | Approved — referenced from README only, run via `npx` from end-user's `claude_desktop_config.json`. Verified via `slopcheck install mcp-remote wrangler` (executed 2026-05-29): both packages returned `[OK]`. No suspicious postinstall scripts. |
| `@modelcontextprotocol/inspector` | npm | ~1 yr (Anthropic-maintained) | recommended in MCP official docs | github.com/modelcontextprotocol/inspector | not run (referenced in README troubleshooting only) | Approved (used Phase 3 already; same role here) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Note on `mcp-remote` community-maintenance risk:** Per research/SUMMARY.md §9 risk flag — `mcp-remote` is community-maintained (single maintainer `geelen`), not Anthropic or Cloudflare. The risk is not "package goes malicious" (verified clean via slopcheck) but "maintainer disappears + Claude Desktop ships a breaking change + nobody patches." Mitigation per CONTEXT.md Claude's Discretion: dated comment in the README config snippet (e.g., `// tested with mcp-remote@0.1.38 on Claude Desktop <ver> 2026-05-29`) is the rollback marker. v0.4+ owns the swap to native Streamable HTTP when Claude Desktop ships it.

## Architecture Patterns

### System Architecture Diagram

```
[Russell's Mac]                          [Cloudflare account]
                                         
  Claude Desktop                         
    │                                     ┌─────────────────────┐
    │ reads claude_desktop_config.json    │  engram-mcp-server  │
    │ launches:                           │  (.workers.dev)     │
    │   npx mcp-remote https://...        │                     │
    ▼                                     │  ├── / (200 JSON)   │
  mcp-remote (subprocess)                 │  ├── /health        │
    │                                     │  ├── /authorize     │
    │ first run only:                     │  │   → KV lookup    │
    │   1. opens browser                  │  │     in           │
    │   2. /authorize redirect            │  │     ENGRAM_      │
    │   3. /token exchange                │  │     IDENTITIES   │
    │   4. caches JWT in ~/.mcp-auth/     │  ├── /token, /jwks  │
    │                                     │  ├── /register      │
    │ steady state: forwards stdio        │  ├── /.well-known/* │
    │ JSON-RPC to /mcp with Bearer JWT    │  └── /mcp           │
    ▼                                     │      → EngramMcp DO │
  Engram Worker @ /mcp ────────────────▶  │        (apiHandler) │
                                          └──────────┬──────────┘
  npm run deploy ────┐                               │ DO RPC
                     │                               ▼
                     │                     ┌─────────────────────┐
                     ▼                     │  WorkspaceDO        │
            evals:ci gate                  │  (lives in          │
            (vitest + promptfoo)           │   mcp-server script)│
                     │                     │   SQLite store      │
                     │ green                └──────────┬──────────┘
                     ▼                                │ vectorize
            wrangler deploy mcp-server                ▼
                     │                     ┌─────────────────────┐
                     │ FIRST                │  engram-triage-     │
                     ▼                     │  worker (.workers   │
            wrangler deploy triage-worker  │  .dev)              │
            (binds WORKSPACE via           │                     │
             script_name="engram-mcp-     │  Queue consumer:    │
             server" — mcp-server must     │  engram-ingest      │
             exist first)                  │                     │
                                          │  RPCs into          │
                                          │  WorkspaceDO        │
                                          │  via script_name    │
                                          │  binding            │
                                          └─────────────────────┘
                                                     ▲
                                                     │ async enrichment
                                          ┌─────────────────────┐
                                          │  Cloudflare Queue   │
                                          │  engram-ingest      │
                                          └─────────────────────┘
                                                     ▲
                                                     │ producer
                                          (mcp-server's `remember()`
                                          calls ctx.waitUntil(
                                            INGEST_QUEUE.send(event)))
                                          
[Russell's filesystem]                    [Acceptance test]
  Pre-Engram job files                    Conv A: "Remember this job: <URL>"
  (markdown, JSON, XLS)                          │
  STAY untouched per D-05                        │ remember() → SQLite + Queue
                                                 │
                                          [wait 1+ hour real wall-clock]
                                                 │
                                          Conv B (new chat session):
                                          "What job did I save?"
                                                 │
                                                 │ recall() → Vectorize query
                                                 │   → SQLite hydrate
                                                 ▼
                                          ✓ Job posting returned
                                            with extracted fields
                                          → record as 07-HUMAN-UAT.md
                                            "### Run 1: <date>" entry
```

### Recommended Project Structure (NO new files; Phase 7 amends 4 existing files + creates 1)

```
engram/
├── README.md                           # AMEND (~100–150 line delta per D-02 + D-08)
├── package.json                        # AMEND (add deploy / deploy:mcp / deploy:triage; extend setup; per D-07 + D-08)
├── packages/mcp-server/package.json    # NO CHANGE (already has `deploy: "wrangler deploy"`)
├── packages/triage-worker/package.json # NO CHANGE (already has `deploy: "wrangler deploy"`)
├── scripts/kv-bootstrap.mjs            # MAYBE amend (--help banner only, per CONTEXT.md integration points)
└── .planning/phases/07-deploy-acceptance/
    ├── 07-HUMAN-UAT.md                 # CREATE at acceptance-test time (Run 1, Run 2, DEP-04 rewire smoke)
    └── 07-RESEARCH.md                  # this file
```

### Pattern 1: wrangler deploy via per-package workspace script

**What:** Each package already exposes a `deploy` script that wraps `wrangler deploy`. The root invokes it via `npm run deploy --workspace=@engram/<name>`.
**When to use:** Always — for both the wrapper and per-package commands.
**Example:**
```jsonc
// Root package.json scripts addition (per D-07 + D-08):
{
  "scripts": {
    // ...existing scripts unchanged...
    "deploy:mcp":     "npm run deploy --workspace=@engram/mcp-server",
    "deploy:triage":  "npm run deploy --workspace=@engram/triage-worker",
    "deploy":         "npm run deploy:mcp && npm run deploy:triage",
    "setup":          "node -e \"console.log('Engram setup: see CONTRIBUTING.md for GSD plugin install steps.')\" && npm install && npm run types:gen && npm run setup:vectorize && npm run setup:queue && node -e \"console.log('\\n[OK] Setup complete.\\n  Next:  npm run deploy        # ships both Workers (runs eval gate first)\\n         see README Step 4      # OAuth bootstrap for Claude Desktop\\n')\""
  }
}
```
Note: `predeploy` (already present, runs `evals:ci`) fires automatically before `deploy` (npm lifecycle hook); per-package `deploy:mcp` / `deploy:triage` skip the `predeploy` gate because npm only fires `predeploy` for the literal `deploy` script. **This is the desired D-08 semantic** — the wrapper enforces evals, the per-package commands skip them for surgical day-N fixes.

**Source verification:** `npm view wrangler@4.95.0` confirms wrangler 4 supports both invocation forms; npm workspaces semantics confirmed via npm docs [CITED: docs.npmjs.com/cli/v11/using-npm/workspaces].

### Pattern 2: Cross-worker DO deploy order

**What:** `packages/triage-worker/wrangler.jsonc` declares `WORKSPACE` as a cross-Worker DO binding via `script_name: "engram-mcp-server"`. The mcp-server Worker MUST exist (i.e., have been deployed at least once) before triage-worker deploys, or Cloudflare's control plane rejects the binding.
**When to use:** Every first-deploy and any deploy after the mcp-server Worker is deleted.
**Example (the literal binding block from `packages/triage-worker/wrangler.jsonc`):**
```jsonc
"durable_objects": {
  "bindings": [
    { "name": "WORKSPACE", "class_name": "WorkspaceDO", "script_name": "engram-mcp-server" }
  ]
}
```
**Implication for `npm run deploy`:** the wrapper MUST chain `deploy:mcp` BEFORE `deploy:triage`. Reversed order fails. The per-package `deploy:triage` documentation must call this out: "requires `engram-mcp-server` to have been deployed at least once."

**Source verification:** Cloudflare official docs on cross-worker DO bindings: "When a Durable Object is external to a Worker, you specify the name of the Worker where the Durable Object is defined using the `script_name` field." [CITED: developers.cloudflare.com/durable-objects/reference/environments]. The DO-defining Worker must exist before binding Workers deploy.

### Pattern 3: mcp-remote bridge in claude_desktop_config.json

**What:** Claude Desktop reads `~/Library/Application Support/Claude/claude_desktop_config.json` at startup and launches each MCP server as a stdio subprocess. For remote MCP servers, the standard pattern is to launch `mcp-remote` as the stdio process, passing the remote URL as an arg. `mcp-remote` handles the OAuth dance (opens browser, completes flow, caches JWT in `~/.mcp-auth/`) and then forwards stdio JSON-RPC to/from the remote endpoint.
**When to use:** Whenever Russell or Devon installs Engram for use from Claude Desktop.
**Example (the canonical snippet for Engram, after deploy):**
```jsonc
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://engram-mcp-server.<your-subdomain>.workers.dev/mcp"
      ]
      // tested with mcp-remote@0.1.38 on Claude Desktop <ver> 2026-05-29
    }
  }
}
```
Replace `<your-subdomain>` with the operator's `workers.dev` subdomain (visible in Cloudflare dashboard under "Workers & Pages"). Restart Claude Desktop after editing the config — Claude Desktop does NOT hot-reload `claude_desktop_config.json`.

**Source verification:** Cloudflare's own official "Test a Remote MCP Server" docs show this exact pattern [CITED: developers.cloudflare.com/agents/guides/test-remote-mcp-server/]. `mcp-remote` README shows the same pattern [CITED: github.com/geelen/mcp-remote]. The `-y` arg (auto-accept install prompt) is in the official mcp-remote README and prevents an interactive prompt that Claude Desktop's subprocess context cannot answer.

### Anti-Patterns to Avoid

- **Deploying triage-worker before mcp-server.** Fails because of `script_name` cross-worker DO binding. The wrapper enforces order; the per-package commands document the precondition.
- **Running `kv:bootstrap` as part of `npm run setup`.** Per D-07, bootstrap REQUIRES a deployed Worker and a real observed `sub` from the OAuth flow — neither exists at `setup` time. Bootstrap is a deliberate Step 4 per D-02.
- **Pinning `mcp-remote` in `package.json`.** The bridge is launched by Claude Desktop's `npx` subprocess on the END-USER's machine, not from this repo's npm tree. Pinning here has no effect. The dated comment in the README config snippet IS the version-rollback marker.
- **Treating the 403 "Unknown OAuth subject" as an error.** Per D-02, it is a normal first-run step. The README's Step 4 frames it as expected, with the literal `sub`-paste workflow inline.
- **Auto-importing pre-Engram job-search agent data.** Per D-05, pre-Engram captures stay in local files forever (historical record). DEP-04 is forward-only rewire; no import script, no dual-write.
- **Trusting Cloudflare's "Settings → Custom Connectors" UI path for v0.1.** That path is newer and may work, but the canonical reproducible path per CONTEXT.md is `claude_desktop_config.json` + `mcp-remote`. Adding two parallel doc paths in v0.1 doubles support surface area for no v0.1 win.
- **Adding a `--env production` or `--env dev` separation in wrangler.jsonc.** Out of scope per CONTEXT.md Claude's Discretion (v0.3 introduces env separation).
- **Stretching DEP-03 acceptance test across only 1 day to save time.** Per D-03, the two-day window IS the test — same-day runs miss any background settling and don't match the real use case.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cloudflare Workers deploy | Custom `curl` against Cloudflare API | `wrangler deploy` | First-party tool; handles bundling, secret upload sequencing, asset uploads, DO migration application, queue binding wiring. Reinventing this is ~1000+ LOC of edge cases. |
| MCP transport bridge | Custom stdio ↔ HTTP proxy in this repo | `mcp-remote` (community) or wait for Claude Desktop native Streamable HTTP | The bridge is a Claude Desktop client-side concern, not an Engram concern. Engram only serves the remote endpoint. |
| OAuth provider | Custom token mint / refresh / jwks endpoints | `@cloudflare/workers-oauth-provider@0.7.0` (already installed) | Library is OAuth 2.1 compliant; rolling our own auth at v0.1 is one of the irreversible decisions Engram explicitly chose NOT to make (decision A9). |
| KV bootstrap UX | Auto-deploy-then-auto-discover-sub-then-auto-write CLI | The 2-step manual paste-the-sub flow (per D-01) | The auto flow is real work (interactive mcp-remote scripting) and v0.4 owns it. Manual flow is honest about its friction and produces real signal on whether the friction bites Devon. |
| Acceptance test automation | Cron-driven 1-hour-wait test in CI | HUMAN-UAT.md with Russell doing it (per D-03) | The "fast-forward time" automation has no signal value — it would test fake timing, not real production. The whole point of DEP-03 is the real Vectorize indexing settle + real Claude Desktop session boundary behavior. |
| Job-search agent dual-write during cutover | Write to BOTH old files AND Engram for N days | Single-capture cutover smoke (per D-06) | Dual-write is technical debt on the agent that must be torn out later. The smoke test catches the most likely failure mode (agent's prompt template doesn't produce a valid `remember()` call shape). |
| README authoring from scratch | Greenfield root README rewrite | Amend existing 443-line root README + reuse `packages/mcp-server/README.md` content (396 lines, MOST of the OAuth + setup content already exists) | Phase 3 already shipped the per-package README. Phase 7 hoists / cross-references the relevant content to the root README's user-facing surface. |

**Key insight:** Phase 7's "build" surface is unusually small because Phase 3 over-delivered on `packages/mcp-server/README.md`. The 396-line per-package README already contains: KV namespace creation, OAuth flow narrative, Claude Desktop config snippets (production + local), kv-bootstrap walkthrough, MCP Inspector smoke procedure, and a Troubleshooting section. Phase 7 work is largely (a) extract the user-facing 80% of that content to the root README per D-02's ordering, (b) wire the npm scripts per D-07 + D-08, (c) run the acceptance test per D-03 + D-04.

## Runtime State Inventory

> This section applies (Phase 7 is a deploy + acceptance phase that touches running infrastructure, not a rename / refactor — but the same runtime-state question applies: what existing state will the deploy touch?).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | None new. Phase 7 deploys code; the WorkspaceDO SQLite schema is unchanged from Phase 6 v3 migration. Vectorize index `engram-memories` already exists per Phase 5 (setup:vectorize). KV namespaces `OAUTH_KV` + `ENGRAM_IDENTITIES` already exist per Phase 3 setup. | None for Phase 7. First post-deploy `remember()` call will create the first real WorkspaceDO instance and populate SQLite + Vectorize. |
| **Live service config** | `mcp-server` and `triage-worker` Workers may already exist in Russell's Cloudflare account from prior `wrangler dev --remote` runs OR from a prior P5/P6 ad-hoc deploy. Re-deploy is safe (wrangler handles version replacement). Queue `engram-ingest` exists per Phase 6 setup:queue. | None — wrangler deploy is idempotent. Verify Workers are reachable post-deploy via `curl https://engram-mcp-server.<sub>.workers.dev/health`. |
| **OS-registered state** | None. Phase 7 does not register any systemd / launchd / Task Scheduler entries. Claude Desktop's `claude_desktop_config.json` is the only OS-touching surface and it's a user-edited config file, not an OS registration. | None for Phase 7. Russell edits `claude_desktop_config.json` per README Step 3 once per machine. |
| **Secrets and env vars** | The Phase 3 `packages/mcp-server/README.md` (line ~100) explicitly notes that `@cloudflare/workers-oauth-provider@0.7.0` does NOT require a `COOKIE_ENCRYPTION_KEY` secret — encryption keys are derived from OAuth grant material in `OAUTH_KV`. No secrets to set via `wrangler secret put`. | None. If a future library version reintroduces a secret binding, that's a forward concern, not Phase 7. |
| **Build artifacts / installed packages** | None stale. Phase 7 doesn't change package shape (no new deps, no version bumps). The two existing per-package `deploy` scripts already work. | None. |

**The canonical question — "after `wrangler deploy` runs, what runtime systems still hold OLD state that contradicts the new deploy?"** Answer: **nothing**. Phase 7 is a fresh deploy of an unchanged code shape; the runtime state Phase 5/6 already provisioned (Vectorize index, KV namespaces, Queue) is consumed unchanged.

## Common Pitfalls

### Pitfall 1: triage-worker deploy fails because mcp-server hasn't been deployed yet
**What goes wrong:** Operator runs `npm run deploy:triage` against a fresh Cloudflare account that has never had `engram-mcp-server` deployed. wrangler fails to resolve the `script_name: "engram-mcp-server"` binding.
**Why it happens:** Cross-worker DO bindings require the script-name target Worker to exist in the account first [CITED: developers.cloudflare.com/durable-objects/reference/environments].
**How to avoid:** The `npm run deploy` wrapper chains `deploy:mcp` first, then `deploy:triage`. README's per-package `deploy:triage` documentation includes a precondition note. The wrapper IS the first-time runbook.
**Warning signs:** Wrangler error message like `Could not find a Worker with the name "engram-mcp-server"` or `[ERROR] Cross-script binding to non-existent Worker`.

### Pitfall 2: KV namespace IDs are still placeholders in `wrangler.jsonc`
**What goes wrong:** First-time deployer runs `wrangler deploy` against `packages/mcp-server/wrangler.jsonc` and KV namespace lookups fail at runtime because the committed IDs are Russell's (or from a previous installer's) account.
**Why it happens:** Per the comment in `packages/mcp-server/wrangler.jsonc`, KV namespace IDs are committed (not secrets, but account-bound). Devon's fresh Cloudflare account has different IDs. The existing `packages/mcp-server/README.md` Step "Create KV namespaces" documents the swap procedure (`npx wrangler kv namespace create OAUTH_KV` + paste real ID into wrangler.jsonc).
**How to avoid:** Phase 7 README Step 2 (deploy) must reference this section in `packages/mcp-server/README.md` OR cross-link to it. Wrangler will not fail at deploy time on bad KV IDs — it fails at runtime when `/authorize` tries to look up the KV. The first OAuth attempt surfaces a 500-class error instead of the expected 403.
**Warning signs:** First `/authorize` hit returns 500 or hangs; Workers logs show `KV namespace not found` or `binding not bound`.

### Pitfall 3: Claude Desktop has cached an old `mcp-remote` JWT
**What goes wrong:** Russell re-deploys after a code change, re-runs `kv:bootstrap` with new `--workspace-id`, but Claude Desktop continues using the cached JWT for the old workspace.
**Why it happens:** `mcp-remote` caches JWTs in `~/.mcp-auth/`. The cache persists across Claude Desktop restarts.
**How to avoid:** Document the cache-clear in Troubleshooting: `rm -rf ~/.mcp-auth/` then restart Claude Desktop. Per `mcp-remote` README [CITED: github.com/geelen/mcp-remote] this is the official workaround for "stale JWT" errors.
**Warning signs:** Tool calls fail with stale `workspace_id` claims; the 5-tool list shows correctly but `remember()` writes to the wrong workspace; or `mcp-remote` reports HTTP 400 on `/token` exchange.

### Pitfall 4: Restart Claude Desktop, not just close the window
**What goes wrong:** Russell edits `claude_desktop_config.json`, closes the Claude Desktop window, opens a new chat — but Claude Desktop is still running in the menubar with the old config.
**Why it happens:** Claude Desktop (Mac) keeps a background process even when the window is closed. It only reads `claude_desktop_config.json` at process launch.
**How to avoid:** README Step 3 explicitly says "**fully quit** Claude Desktop (Cmd+Q on macOS, right-click → Exit on Windows) and re-launch" — not "close the window."
**Warning signs:** Tool list doesn't update after a config edit; new `mcpServers` entries don't appear.

### Pitfall 5: `mcp-remote` argv mangling on Windows (per geelen/mcp-remote README)
**What goes wrong:** Devon (Windows) configures `claude_desktop_config.json` with a URL containing query params or spaces. Claude Desktop's `npx` invocation mangles the args.
**Why it happens:** Documented `mcp-remote` issue: "Cursor and Claude Desktop (Windows) have a bug where spaces inside `args` aren't escaped" [CITED: github.com/geelen/mcp-remote].
**How to avoid:** Engram's `/mcp` endpoint URL has no spaces and no query params — the standard config works. Document the gotcha in Troubleshooting only if a future feature adds URL query params (none planned for v0.1).
**Warning signs:** `mcp-remote` exits immediately with "invalid URL" or connects to the wrong endpoint.

### Pitfall 6: Eval gate fails on deploy and the failure mode is unclear
**What goes wrong:** Russell runs `npm run deploy`, the `predeploy` hook runs `evals:ci`, an LLM-non-determinism flake fails one promptfoo assertion, deploy aborts. Russell doesn't know whether to re-run or investigate.
**Why it happens:** LLM evals (promptfoo against Workers AI) have inherent variance.
**How to avoid:** README's "Deploy" section documents: "if `npm run deploy` fails at the eval gate, re-run once; if it fails twice, investigate via `npm run evals:ci` directly to see which assertion failed. For surgical re-deploy after a small code fix (not an eval regression), use `npm run deploy:mcp` or `npm run deploy:triage` to skip the gate."
**Warning signs:** Deploy aborts with promptfoo or vitest evals output; specific assertion failure visible in stdout.

### Pitfall 7: First conversation works, second conversation can't recall
**What goes wrong (in DEP-03 acceptance test):** Run 1 remembers a job in conv A. After 1+ hour wait, conv B's `recall()` returns zero results.
**Why it happens:** Most likely causes — (a) `workspace_id` mismatch between conv A and conv B because mcp-remote's JWT cache returned a different value; (b) the `remember()` call's Queue side-effect failed and the Vectorize embedding never landed; (c) bug in Vectorize namespace handling.
**How to avoid:** Before logging the DEP-03 Run 1 result, verify in conv A immediately: call `recall()` with the same query, confirm the just-stored block returns. If it does → conv-A-side write succeeded. If conv B fails after, the issue is workspace-id or Vectorize indexing, NOT a missed write. The 1-hour wait dwarfs Vectorize's "a few seconds" indexing delay [CITED: Cloudflare community docs on Vectorize eventual consistency], so timing is NOT the failure cause.
**Warning signs:** `recall()` in conv B returns `{ memories: [], synthesis: null, chunks: [] }` — the EngramResponse envelope is correct but empty.

### Pitfall 8: HUMAN-UAT.md frontmatter shape drift
**What goes wrong:** Russell writes the Run 1 entry without matching GSD's HUMAN-UAT frontmatter convention; `/gsd:audit-uat` doesn't see the entry; phase verification misses DEP-03 evidence.
**Why it happens:** Frontmatter is a GSD convention, not enforced by lint.
**How to avoid:** Use the standard GSD HUMAN-UAT.md shape (frontmatter + `### Run N: {date}` sections); planner can specify the exact frontmatter at plan time by cross-referencing Phase 5's HUMAN-UAT file if one exists, else GSD's standard `audit-uat` documentation.
**Warning signs:** `/gsd:audit-uat` reports zero UAT entries for Phase 7 even though `07-HUMAN-UAT.md` exists.

## Code Examples

Verified patterns from existing repo + official docs:

### Add the deploy / setup scripts to root package.json (D-07 + D-08)
```jsonc
// Source: docs.npmjs.com/cli/v11/using-npm/workspaces (workspace flag syntax)
//         Cloudflare official "Test a Remote MCP Server" guide (deploy invocation)
//         Engram's own packages/mcp-server/package.json + packages/triage-worker/package.json
//         already define `deploy: "wrangler deploy"` — root just chains them.
{
  "scripts": {
    // ...existing scripts unchanged...
    "setup": "node -e \"console.log('Engram setup: see CONTRIBUTING.md for GSD plugin install steps.')\" && npm install && npm run types:gen && npm run setup:vectorize && npm run setup:queue && node -e \"console.log('\\n[OK] Setup complete.\\n  Next:  npm run deploy        # ships both Workers (runs eval gate first)\\n         see README Step 4      # OAuth bootstrap for Claude Desktop\\n')\"",

    "deploy:mcp":    "npm run deploy --workspace=@engram/mcp-server",
    "deploy:triage": "npm run deploy --workspace=@engram/triage-worker",
    "deploy":        "npm run deploy:mcp && npm run deploy:triage"

    // predeploy is ALREADY present and runs evals:ci; npm fires it before `deploy`
    // but NOT before `deploy:mcp` / `deploy:triage` (npm only fires `pre<X>` hooks
    // for the literal script `X`). This is the desired D-08 semantic: wrapper
    // enforces evals, per-package commands skip.
  }
}
```

### claude_desktop_config.json snippet for Engram (DEP-02 / D-02 README Step 3)
```jsonc
// Source: developers.cloudflare.com/agents/guides/test-remote-mcp-server/
//         github.com/geelen/mcp-remote (README example)
//         Engram's packages/mcp-server/README.md "Production" snippet (already-shipped Phase 3)
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://engram-mcp-server.<your-subdomain>.workers.dev/mcp"
      ]
      // tested with mcp-remote@0.1.38 on Claude Desktop <version> 2026-05-29
    }
  }
}
```

### Step 4 bootstrap walkthrough (DEP-02 / D-02 inline README)
```bash
# Source: packages/mcp-server/src/oauth.ts line 201 (the literal 403 body)
#         scripts/kv-bootstrap.mjs (existing CLI; --help banner is the only
#         possible Phase 7 amendment per CONTEXT.md integration points)

# After deploy + Claude Desktop config, the first time you ask Claude to use
# any Engram tool, mcp-remote opens a browser tab to /authorize. You will see:
#
#   Unknown OAuth subject: <some-long-string>. Bootstrap via npm run kv:bootstrap.
#
# This is EXPECTED — it's the bootstrap signal. Copy the <some-long-string>
# value (it's the OAuth subject claim from your mcp-remote's dynamic
# registration; safe to log — not a secret). Then from the engram repo root:

npm run kv:bootstrap -- \
  --sub <some-long-string> \
  --workspace-id <pick-an-identifier-for-your-workspace> \
  --user-id <pick-an-identifier-for-yourself>

# Restart Claude Desktop (fully quit + relaunch). The next tool call works.
```

### DEP-03 / DEP-04 HUMAN-UAT.md shape (created at acceptance-test time)
```markdown
---
phase: 07
status: in_progress  # → "passed" when both runs + rewire smoke pass
captured_by: russell
---

# Phase 7 HUMAN-UAT — Deploy + Acceptance

## DEP-03: Cross-conversation recall

### Run 1: 2026-05-30
- **Expected:** `recall("what job did I save earlier?")` in a fresh Claude Desktop
  chat returns the job posting (URL + company + role) `remember()`'d 1+ hour
  earlier in a separate chat.
- **Job posting used (conv A):** <e.g. Anthropic Solutions Engineer SF — URL>
- **Wait duration:** <e.g. 75 minutes>
- **Result:** <pending | pass | fail>
- **Conv A excerpt:** <paste verbatim>
- **Conv B excerpt:** <paste verbatim>
- **Notes:** <any deviations, env state>

### Run 2: 2026-05-31
- **Expected:** Same as Run 1 but with a DIFFERENT job posting (different
  role + company + URL) — exercises Vectorize semantic match, not memoization.
- **Job posting used (conv A):** <different posting>
- **Wait duration:** <e.g. 90 minutes>
- **Result:** <pending | pass | fail>
- ...

## DEP-04: Job-search agent rewire smoke

### Rewire smoke: 2026-05-31
- **Expected:** With the agent rewired to call Engram's `/mcp`, paste a fresh
  job posting → agent calls `remember()` → `recall()` in same chat verifies
  block landed. Next day, fresh chat, ask "what jobs have I saved?" → recent
  capture returned with extracted fields.
- **Result:** <pending | pass | fail>
- ...
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `wrangler publish` | `wrangler deploy` | wrangler 3 → 4 (2025) | `publish` is removed; Engram already uses `deploy`. No action. |
| `wrangler.toml` | `wrangler.jsonc` | Cloudflare recommendation 2024–2025 | Engram already uses `.jsonc` per Phase 1 FND-02. No action. |
| `claude_desktop_config.json` as the ONLY remote-MCP path | `claude_desktop_config.json` (with `mcp-remote`) AND Settings → Custom Connectors UI path BOTH supported | 2025-Q4 → 2026 | Both work in 2026 [CITED: support.claude.com/en/articles/11175166]. Engram stays with config-file path for v0.1 (CONTEXT.md alignment); UI path is informational only. |
| `mcp-remote` as the universal bridge | `mcp-remote` STILL the canonical bridge for Cloudflare-hosted remote MCP per Cloudflare's own docs [CITED]; Claude Desktop natively understands stdio + (increasingly) Streamable HTTP for custom connectors UI | 2026 ongoing | `mcp-remote@0.1.38` (2026-02-05) is the current version; community-maintained risk per SUMMARY.md §9 is live but not biting. v0.4+ owns the swap. |

**Deprecated/outdated (do NOT use):**
- `wrangler publish` — removed in wrangler 4; use `wrangler deploy`.
- `new_classes` for SQLite Durable Object migrations — use `new_sqlite_classes`. Already enforced by Engram's FND-08 lint.

## Assumptions Log

> Claims tagged `[ASSUMED]` in this research. Discuss-phase has already happened (D-01..D-08 are locked in CONTEXT.md), so the assumptions below are research-process assumptions that the planner should sanity-check, not user decisions requiring confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Cross-worker DO binding requires the target Worker to exist at deploy time (mcp-server before triage-worker). | Pattern 2 + Pitfall 1 | If wrong, deploy order doesn't matter and the `deploy` wrapper's serial chaining is harmless overkill. Source [CITED: Cloudflare DO environments docs] strongly supports the claim but doesn't explicitly cite the error message; planner could verify by reading wrangler-source or running a controlled experiment. Either way, the wrapper's chosen order is correct. |
| A2 | Claude Desktop's claude_desktop_config.json reload requires full app quit, not just window close (Mac). | Pitfall 4 | If wrong, the Troubleshooting note over-instructs but doesn't break anything. Based on widely-reported community behavior; no official Anthropic doc citation. |
| A3 | LLM eval gates may flake occasionally on Workers AI variance, justifying a "re-run once" troubleshooting hint. | Pitfall 6 | If wrong, the hint is a no-op (flakes don't happen, every failure is signal). No downside. Phase 5 already-implemented evals are deterministic-ish but LLM-backed; one re-run is conservative guidance. |
| A4 | `npm run deploy:mcp` / `deploy:triage` skip the `predeploy` hook because npm only fires `pre<X>` for the literal script `X`. | Pattern 1 + D-08 semantic | Verified npm lifecycle docs [CITED: docs.npmjs.com/cli/v11/using-npm/scripts] — npm fires `pre<X>` only for the exact script `X`. The wrapper's `deploy` triggers `predeploy`; `deploy:mcp` does not. This IS the desired D-08 semantic. |
| A5 | The Phase 3 `packages/mcp-server/README.md` content is already correct and durable — Phase 7's root README amendment can largely cross-reference / hoist from it. | "Don't Hand-Roll" key insight + READme structure | If the Phase 3 README has rotted (e.g., wrong KV ID instructions, stale OAuth flow), Phase 7's root README would inherit the rot. Planner should diff the Phase 3 README against current code as a Wave 0 sanity check. |

## Open Questions

1. **What's the exact `workers.dev` subdomain Russell's account uses?**
   - What we know: per `packages/mcp-server/README.md`, the placeholder is `<your-subdomain>` and Russell sees the real value in the Cloudflare dashboard under "Workers & Pages."
   - What's unclear: whether Russell has a vanity subdomain set OR whether his account uses the auto-assigned `<random>.workers.dev` form.
   - Recommendation: Don't hard-code in the README. Keep the `<your-subdomain>` placeholder pattern from the Phase 3 README and have Russell capture the real value once during his Phase 7 execution.

2. **Does the existing `npm run setup` final-echo wording need tone matching?**
   - What we know: CONTEXT.md Claude's Discretion proposes literal text `"\n[OK] Setup complete.\n  Next:  npm run deploy        # ships both Workers (runs eval gate first)\n         see README Step 4      # OAuth bootstrap for Claude Desktop\n"`.
   - What's unclear: whether the rest of the README uses `[OK]` ASCII markers vs unicode check marks, and whether the multi-line echo renders correctly in npm output (Windows cmd.exe vs PowerShell vs Unix terminal).
   - Recommendation: Planner verifies the existing README's tone (current README uses no emojis per global directive "Only use emojis if the user explicitly requests it") and tests the echo on Russell's actual terminal during execute-phase Wave 1. ASCII-only is safest cross-platform.

3. **For the DEP-04 rewire smoke, does the job-search agent live in a separate repo or embedded in Russell's Claude config?**
   - What we know: per D-05, the agent is "Russell's existing job-search agent" (external — not in this repo). The rewire is a config swap on the agent side.
   - What's unclear: whether the rewire is a `claude_desktop_config.json` change (adding Engram's mcp-remote alongside the agent), an agent-prompt change (agent told to call Engram tools), or something else.
   - Recommendation: Out of scope for THIS phase's research; Russell will know at execution time. Plan task for DEP-04 should be "Russell rewires agent (off-repo); single HUMAN-UAT entry captures the smoke." No tasks in this repo block on it.

## Environment Availability

> Phase 7 has external dependencies (`wrangler`, npm, Cloudflare account, Claude Desktop). Audited 2026-05-29.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `wrangler` (CLI) | All deploy tasks | ✓ via `node_modules/.bin/wrangler` (devDep) | 4.95.0 (verified) | — |
| Node.js | wrangler + npm scripts | ✓ (engines pin `>=22`; verified by current `npm view wrangler engines` requiring `node >=22.0.0`) | — | — |
| npm | workspace deploy delegation | ✓ (engines pin `>=10`) | — | — |
| `npx` | running `mcp-remote` from Claude Desktop config + invoking wrangler subcommands | ✓ (bundled with npm 10) | — | — |
| `mcp-remote` (npm) | Claude Desktop bridge | ✓ via `npx -y mcp-remote` on first run (no install needed at this repo level) | 0.1.38 latest, slopcheck `[OK]` | None needed — Custom Connectors UI is the alt path but per CONTEXT.md not used in v0.1 |
| Cloudflare account (Russell's) | `wrangler deploy` target | Assumed ✓ (Phase 5/6 deploys already ran here) | — | — |
| Cloudflare KV namespaces `OAUTH_KV` + `ENGRAM_IDENTITIES` | OAuth provider runtime | Assumed ✓ (Phase 3 setup created them; IDs committed in wrangler.jsonc) | — | If Devon clones fresh, README Step "Create KV namespaces" reuses the existing Phase 3 README's content |
| Cloudflare Vectorize index `engram-memories` | recall() runtime | Assumed ✓ (Phase 5 setup:vectorize created it) | — | Re-run `npm run setup:vectorize` (idempotent) |
| Cloudflare Queue `engram-ingest` | remember() async pipeline | Assumed ✓ (Phase 6 setup:queue created it) | — | Re-run `npm run setup:queue` (idempotent) |
| Claude Desktop (Mac) on Russell's machine | DEP-02 + DEP-03 acceptance | Assumed ✓ (existing project artifact) | — | — |
| Russell's job-search agent | DEP-04 rewire | Assumed ✓ (off-repo; not researcher's responsibility to verify) | — | If agent is broken, DEP-04 surfaces as a HUMAN-UAT FAIL and gap-closure follows |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

> `workflow.nyquist_validation` setting not checked but per CONTEXT.md Claude's Discretion ("No new test infra. Phase 7's verification is HUMAN-UAT-driven plus the deploy gate's existing eval suite"), Phase 7's validation surface is HUMAN-UAT + the existing `evals:ci` gate. The section below documents that posture explicitly.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.7 + promptfoo 0.121.13 (already wired Phase 5; both run via `npm run evals:ci`) |
| Config file | `packages/mcp-server/vitest.config.ts` + `packages/triage-worker/vitest.config.ts` + `packages/triage-worker/evals/triage-extraction.promptfoo.yaml` |
| Quick run command | `npm run evals:ci` (chained: `evals:vitest` + `evals:promptfoo`) |
| Full suite command | `npm test` (all `vitest run` across workspaces) |
| Phase gate | `npm run predeploy` (which is `npm run evals:ci`) fires automatically before `npm run deploy` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEP-01 | Both Workers deploy successfully | smoke (manual + idempotent) | `npm run deploy` (returns 0 + Workers URLs printed) | N/A — wrangler is the smoke |
| DEP-02 | Claude Desktop sees 5 Engram tools after config edit + bootstrap | manual-only | n/a (visual check in Claude Desktop UI; one HUMAN-UAT note line) | N/A |
| DEP-03 | Cross-conversation recall passes ≥2 runs over 1–2 day window | manual-only (HUMAN-UAT) | `07-HUMAN-UAT.md` Run 1 + Run 2 entries | ❌ created at acceptance time |
| DEP-04 | Job-search agent rewire smoke passes | manual-only (HUMAN-UAT) | `07-HUMAN-UAT.md` Rewire smoke entry | ❌ created at acceptance time |
| DEP-05 | README documents prereqs / setup / config / troubleshooting | structural (visual diff) | none — planner / human review during plan-checker | ✅ root `README.md` exists; amendment expected |

### Sampling Rate
- **Per task commit:** No automated test changes in Phase 7. CI's existing `npm test` + `lint:wrangler` + `lint:blockconcurrency` gates fire on every push.
- **Per wave merge:** Same as above.
- **Phase gate:** `evals:ci` passes (already enforced by `predeploy` hook on `npm run deploy`); `07-HUMAN-UAT.md` shows both DEP-03 runs + DEP-04 rewire smoke at `pass`; `/gsd:verify-work` reads the file.

### Wave 0 Gaps
- [ ] `07-HUMAN-UAT.md` — covers DEP-03 + DEP-04 (created at acceptance-test time, not at Wave 0)
- [ ] Framework install: none — all eval / lint infra is pre-existing.

*If no gaps: this phase intentionally ships no new test infra per CONTEXT.md.*

## Security Domain

> Phase 7 deploys existing code; the security surface is what Phase 3 already locked. The audit below is light because no new auth/crypto/storage surface lands in Phase 7. (If `security_enforcement: false` is explicitly set in `.planning/config.json`, this section can be skipped — but the section content adds little overhead and documents that Phase 7 doesn't introduce new threats.)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | `@cloudflare/workers-oauth-provider@0.7.0` — locked Phase 3, no change in Phase 7 |
| V3 Session Management | yes (inherited) | OAuth JWT + EngramMcp session DO — locked Phase 3 |
| V4 Access Control | yes (inherited) | STO-07 defense-in-depth (`state.id.name === workspace_id` on every WorkspaceDO method) — locked Phase 2 |
| V5 Input Validation | yes (inherited) | zod schemas on every tool input — locked Phase 3/4 |
| V6 Cryptography | yes (library-owned) | OAuth grant encryption derived from `OAUTH_KV` — handled by the library, not Engram code |

### Known Threat Patterns for Phase 7

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| KV namespace ID misconfiguration on first deploy | Spoofing (operator deploys with placeholder/wrong account's IDs and OAuth state collides) | Per `packages/mcp-server/README.md` "Create KV namespaces" section — `npx wrangler kv namespace create OAUTH_KV` + paste real ID. README cross-references this in Step 2 of Getting Started. |
| Operator commits real KV IDs that point at someone else's account | Information Disclosure (mild — KV IDs are not secrets per `wrangler.jsonc` comments, but they reveal the account topology) | KV IDs ARE committed in `wrangler.jsonc` per design (Phase 3 D-10: KV namespace IDs are not secrets). New operators DO swap them per the Phase 3 README. Phase 7 README must point at the Phase 3 README's section, not silently inherit the placeholders. |
| Operator commits real OAuth `sub` value to git via `07-HUMAN-UAT.md` or commit message | Information Disclosure (mild — sub is dynamic per-installation, not a long-term secret, but exposing it post-bootstrap reveals identity-mapping shape) | HUMAN-UAT.md captures conv A / conv B excerpts but should NOT include the literal `sub` value. Planner adds a comment in the HUMAN-UAT template directing operators to redact `<sub>` if pasted in conv excerpts. |
| `mcp-remote` supply-chain risk (community-maintained, single maintainer) | Tampering | slopcheck `[OK]` verified 2026-05-29 (no postinstall scripts, no suspicious deps). Dated comment in README config snippet (`// tested with mcp-remote@0.1.38 on Claude Desktop <ver> 2026-05-29`) is the rollback marker — if a future mcp-remote release breaks the bootstrap flow, the dated snippet anchors the working version. v0.4+ owns the swap to native Streamable HTTP per CONTEXT.md Deferred Ideas. |

## Sources

### Primary (HIGH confidence)
- `developers.cloudflare.com/agents/guides/test-remote-mcp-server/` — official Claude Desktop + mcp-remote config snippet [CITED]
- `developers.cloudflare.com/durable-objects/reference/environments/` — cross-worker DO binding via `script_name` [CITED]
- `developers.cloudflare.com/workers/wrangler/commands/` — wrangler deploy + global flags (verified locally via `npx wrangler deploy --help` on 4.95.0)
- `packages/mcp-server/src/oauth.ts` — the literal 403 error string Phase 7 README references [VERIFIED: code]
- `packages/mcp-server/README.md` (lines 1–400) — already-shipped Phase 3 docs that Phase 7 hoists / cross-references [VERIFIED: code]
- `packages/mcp-server/wrangler.jsonc` + `packages/triage-worker/wrangler.jsonc` — deploy targets and binding shapes [VERIFIED: code]
- `package.json` (root) — existing setup / evals:ci / predeploy scripts [VERIFIED: code]
- `scripts/kv-bootstrap.mjs` — existing CLI with `--help`, `--dry-run`, `--local` flags [VERIFIED: code]
- `docs.npmjs.com/cli/v11/using-npm/workspaces` + `docs.npmjs.com/cli/v11/using-npm/scripts` — workspace flag syntax + lifecycle hook firing semantics [CITED]
- `npm view wrangler version` → 4.95.0 (published 2026-05-26) [VERIFIED: npm registry + slopcheck]
- `npm view mcp-remote version` → 0.1.38 (published 2026-02-05) [VERIFIED: npm registry + slopcheck]

### Secondary (MEDIUM confidence)
- `github.com/geelen/mcp-remote` README — Claude Desktop config example, `-y` flag rationale, `~/.mcp-auth/` cache + clear procedure, Windows argv-mangling gotcha [CITED]
- `support.claude.com/en/articles/11175166` — Custom Connectors UI as the newer alt path; both paths supported in 2026 [CITED]
- `modelcontextprotocol.io/docs/develop/connect-remote-servers` — official Custom Connectors UI walkthrough (informational; Engram uses config-file path) [CITED]
- Cloudflare community thread on Vectorize eventual consistency — "a few seconds" for upsert visibility; well under DEP-03's 1-hour wait [CITED]

### Tertiary (LOW confidence — assumed without recent doc verification)
- Pitfall 2 / Pitfall 4 / Pitfall 6 troubleshooting hints — based on widely-reported community behavior, not explicit Anthropic/Cloudflare doc statements. Low-risk to document since they're either no-op (if wrong) or already-validated by Phase 3 README.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages; existing deps verified at npm + slopcheck.
- Architecture: HIGH — cross-worker DO deploy order verified via Cloudflare official docs; mcp-remote bridge confirmed by Cloudflare's own MCP server testing guide.
- Pitfalls: MEDIUM-HIGH — pre-existing Phase 3 README plus active community-reported gotchas for mcp-remote + Claude Desktop on Mac/Windows.
- README structure: HIGH — Phase 3 already over-delivered the per-package README; Phase 7 is hoisting + reordering + cross-linking.

**Research date:** 2026-05-29
**Valid until:** 2026-06-29 (30 days for stable ops domain; reassess `mcp-remote` version + Claude Desktop native-Streamable-HTTP shipping date sooner if v0.4 starts.)
