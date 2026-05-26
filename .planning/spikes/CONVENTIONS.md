# Spike Conventions

Patterns established across the Engram spike sessions. New spikes follow these unless the question requires otherwise.

## Stack

- **Runtime:** Cloudflare Workers via `wrangler dev` against REAL Cloudflare bindings (AI, Vectorize, KV — no local emulation for these). Matches Engram's production stack so spike findings translate directly to Phase plans.
- **Worker language:** TypeScript. `compatibility_date: "2026-05-22"`, `compatibility_flags: ["nodejs_compat"]` (mirrors the production `packages/*` `wrangler.jsonc` shape).
- **Harness language:** Plain Node.js ESM (`.mjs`). Run with `node scripts/run-spike.mjs`. No build step, no test runner — the harness IS the test.
- **Auth:** `wrangler login` against Russell's Cloudflare account before any spike that calls AI / Vectorize / KV. Cost is typically cents per spike run.
- **Markup for reports:** plain HTML + inline CSS. No bundler, no framework. The `results/results.html` viewer is a single self-contained file double-clickable from the file manager.

## Structure

Per-spike directory layout (used in 001, 002, 003):

```text
.planning/spikes/NNN-descriptive-name/
├── README.md             # YAML frontmatter + What This Validates + Research +
│                         # How to Run + Investigation Trail + Results
├── wrangler.jsonc        # AI binding only; port 89NN where NN = spike number
├── src/
│   └── worker.ts         # One Worker per spike with one POST endpoint
├── samples/              # Optional; first spike of a related set owns the corpus
├── scripts/
│   └── run-spike.mjs     # Node harness — POST samples, score, write results.json + results.html
└── results/
    ├── results.json      # Machine-readable
    └── results.html      # Per-sample viewer
```

Naming:

- Worker name = `engram-spike-NNN-<short-name>` (e.g., `engram-spike-001-extraction`)
- Port = `89NN` where NN is the spike number (spike 001 → 8901, etc.)
- Shared sample corpus lives in the first spike of a related set; later spikes reference via relative path (`../001-extraction-precision-recall/samples`)

## Patterns

### Worker shape

- Single POST endpoint per spike (`/extract`, `/summarize`, `/embed`). Plus `/health` for liveness checks.
- Request validates input minimally, calls `env.AI.run(...)`, returns `{ ...result, elapsed_ms }`.
- Error path: `Response.json({ error, message }, { status: 502 })` — surfaced verbatim by the harness for the audit trail.

### Harness shape

- Read samples → POST one by one → score → aggregate → write results.json + results.html.
- Per-sample stdout: `id ✓/⚠/✗ <metric>=<value> (<elapsed>ms)`. Per-bucket and overall summaries at the end.
- Decision gate logic baked into the harness (`decideGate(metric)` function) so the verdict is reproducible, not editorial.
- HTML viewer always renders: gate banner (green/yellow/red), aggregate stats table, per-sample detail rows.

### Synthetic-recalibrated decision gates

For spikes that use synthetic samples (which are cleaner than real-world), the original real-world gate is tightened to compensate for the optimism bias. Applied uniformly across spikes 001-003:

- Original gate: ≥85% / 70-85% / <70%
- Synthetic-recalibrated: ≥90% / 75-90% / <75%
- Real-corpus validation is deferred to the consuming Phase's plan (TOL-08 for spike 001-002 findings; AI-04 acceptance for spike 003).

### Real Workers AI calls (cost discipline)

- `wrangler dev` against AI binding ALWAYS hits real Cloudflare AI — no local emulation. Each run typically costs $0.01-0.05 total (under cents per sample).
- Batched calls preferred when the model supports them (`bge-base-en-v1.5` accepts `text: string[]`). Reduces both latency and per-call overhead.
- Latency variance is real: cold starts hit 5-13 seconds; warm calls 500-900ms. Do not over-interpret single-sample outliers.

### File hygiene

- `.planning/spikes/**` is ESLint-ignored (added to `eslint.config.mjs` during spike 001 commit). Spike code is throwaway and intentionally outside the tsconfig project.
- Prettier runs on spike `.mjs` / `.ts` files during pre-commit — accept the reformatting.
- Markdown lint (md060 / md032 / md040 / md012) applies. Use `| --- |` (spaced) in tables, surround lists with blank lines, language-tag code fences, no trailing blank lines.

### Verdict discipline

- **VALIDATED** only when gate is met AND no surprising failure pattern was found. Spike 001 didn't qualify despite F1=90.2% because the per-bucket research_note was borderline AND the hallucination pattern was surprising.
- **PARTIAL** for "the gate is met but with caveats" OR "the gate isn't met but the spike is informative." Common case for this set — 3/3 spikes are PARTIAL.
- **INVALIDATED** for a clean failure of the hypothesis. None of 001-003 hit this.
- Always document Investigation Trail BEFORE writing verdict. "Depth over speed" — never declare after a single happy-path test.

## Tools & Libraries

- `wrangler@4.94.0` — matches root package.json devDep
- Node 22+ for the harness (matches Engram's root `engines.node >=22`)
- No npm packages installed inside spike directories — harness uses Node built-ins only (`node:fs/promises`, `node:path`, `node:url`, `fetch`)
- `gpt-tokenizer` is the planned Phase 4 dep for MCP-08 (D-09 in Phase 4 CONTEXT.md) — not used in spikes 001-003

## Things to avoid

- Don't add spike directories to npm workspaces. `package.json` `workspaces: ["packages/*", "shared/*"]` deliberately excludes `.planning/`.
- Don't reuse a production Worker (`packages/mcp-server`) for spikes. Spikes are isolated by design.
- Don't ship complex package management or build steps inside a spike — if a spike needs that, it's no longer a spike.
- Don't trust a single-run verdict. Cold-start variance and synthetic-sample optimism bias both demand documented investigation trails.
