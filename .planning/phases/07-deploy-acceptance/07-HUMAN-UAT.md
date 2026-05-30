---
status: in_progress
phase: 07-deploy-acceptance
source: [REQUIREMENTS.md#DEP-03, REQUIREMENTS.md#DEP-04]
captured_by: russell
started: 2026-05-30T03:09:11Z
updated: 2026-05-30T03:09:11Z
---

# Phase 7 HUMAN-UAT — Deploy + Acceptance

> Created as an empty skeleton at plan-execute time per CONTEXT.md D-04 + planning_context Key Finding #5.
> Russell populates each test entry's `Result:` + body fields DURING the 1-2 day acceptance window.
> Phase 7 does not close until all three tests are `[pass]` per PATTERNS §"HUMAN-UAT.md gap-closure flow" — there is no "phase-passes-with-known-issues" escape hatch for DEP-03 (CONTEXT.md `<specifics>`).

## Current Test

[awaiting human testing]

## Deployed URLs (DEP-01 satisfied 2026-05-30)

- **mcp-server (producer):** `https://engram-mcp-server.russellkmoore.workers.dev`
- **triage-worker (consumer):** `https://engram-triage-worker.russellkmoore.workers.dev`
- **Cloudflare account:** `2b0a49e80e2c9fd83946bbcefb4c0e3d` (`russellkmoore@mac.com`)
- **mcp-server version:** `1f209f19-3e59-4f1b-9d86-100e46f03f3a`
- **triage-worker version:** `d4df0c97-7ba7-4c00-827e-cb5db1d9ccd3`
- **Resources provisioned during deploy:**
  - Queue `engram-ingest` (created via `npm run setup:queue`)
  - Vectorize index `engram-memories` (created via `npm run setup:vectorize`; preset `@cf/baai/bge-base-en-v1.5`, metadata indexes `type` + `scope`)
  - KV namespaces `OAUTH_KV` (81c76a03...) + `ENGRAM_IDENTITIES` (97f6ecf0...) already existed
- **For Claude Desktop config:** point `mcp-remote` at `https://engram-mcp-server.russellkmoore.workers.dev/mcp` (see README §Getting Started → Step 3 for the snippet, Step 4 for OAuth bootstrap)

## Operator Notes (read before running)

- **Redact OAuth `sub` values** if they appear in any conv excerpt you paste below. The `sub` is dynamic per `mcp-remote` registration (not a long-term secret), but exposing it in version control reveals identity-mapping shape. Use `<sub-redacted>` as the replacement marker.
- **Two real wall-clock runs over 1-2 days** per D-03. Run 1 morning of Day N → recall afternoon of Day N (1+ hour gap). Run 2 morning of Day N+1 → recall afternoon of Day N+1, using a DIFFERENT job posting (different role/company/URL) to exercise Vectorize semantic recall vs memoization of the exact same content.
- **Verify the conv-A-side write succeeded BEFORE relying on the 1+ hour wait** per RESEARCH §Pitfall 7. In conv A, immediately after `remember()`, call `recall()` with the same query and confirm the just-stored block returns. If it does → conv-A-side write is good. If conv B fails after the wait, the issue is workspace_id mismatch or Vectorize namespace handling, NOT a missed write.
- **DEP-04 rewire smoke is exclusively forward-looking** per D-05 — no migration of pre-Engram job files. Pre-Engram local files (markdown, JSON, XLS) stay untouched on disk as historical record. The rewire is a capture-path swap on the agent side; this UAT entry verifies the new path works end-to-end.
- **Bootstrap prerequisite:** before Run 1, complete README §Getting Started → Step 4 (the OAuth bootstrap walkthrough). The acceptance test assumes Claude Desktop is already connected to the deployed `/mcp` endpoint with a valid `ENGRAM_IDENTITIES` KV record for the bootstrapped `sub`.

## Tests

### Run 1: <TBD: YYYY-MM-DD>

- **DEP ID:** DEP-03
- **Expected:** In a fresh Claude Desktop chat session (conv B, no shared history with the conv that performed the `remember`), asking "what job posting did I save earlier?" causes Claude to call `recall` against Engram and return the posting with extracted fields (URL + company + role) intact.
- **Conv A action:** `remember()` a fresh job posting (URL + role + company) via Claude Desktop.
- **Job posting used (conv A):** <TBD: e.g. "Anthropic Solutions Engineer SF — https://...">
- **Wait duration:** <TBD: actual wall-clock minutes between conv A `remember()` and conv B `recall()` — must be ≥60 minutes per DEP-03>
- **Conv B action:** New Claude Desktop chat → "what job posting did I save earlier?"
- **Same-conv `recall()` smoke (RESEARCH §Pitfall 7 mitigation):** <TBD: pass | fail — did conv A's immediate `recall()` after `remember()` return the just-stored block?>
- **Result:** [pending]
- **Conv A excerpt (redact `<sub>`):** <TBD>
- **Conv B excerpt (redact `<sub>`):** <TBD>
- **Notes:** <TBD: any deviations, env state, observed timing, anomalies>

### Run 2: <TBD: YYYY-MM-DD (next calendar day per D-03)>

- **DEP ID:** DEP-03
- **Expected:** Same shape as Run 1 but with a **different** job posting (different role + company + URL) to exercise Vectorize semantic recall, not memoization of Run 1's content.
- **Conv A action:** `remember()` a DIFFERENT fresh job posting.
- **Job posting used (conv A):** <TBD: must be different role + company + URL from Run 1>
- **Wait duration:** <TBD: ≥60 minutes>
- **Conv B action:** New Claude Desktop chat → "what job posting did I save earlier?"
- **Same-conv `recall()` smoke (RESEARCH §Pitfall 7 mitigation):** <TBD: pass | fail>
- **Result:** [pending]
- **Conv A excerpt (redact `<sub>`):** <TBD>
- **Conv B excerpt (redact `<sub>`):** <TBD>
- **Notes:** <TBD>

### Rewire smoke: <TBD: YYYY-MM-DD>

- **DEP ID:** DEP-04
- **Expected:** With Russell's existing job-search agent reconfigured to use Engram as its memory backend (capture path swap; NO migration of pre-Engram local files per D-05), the following end-to-end smoke passes:
  1. Paste a fresh job posting into the agent → agent calls Engram `remember()` → verify the block landed by calling Engram `recall()` in the same conversation.
  2. Next day, open a fresh Claude conversation → ask the same agent "what jobs have I saved?" → verify the recent capture is returned with extracted fields.
- **Agent rewire location:** <TBD: claude_desktop_config.json change | agent prompt template change | other — Russell will know at execution time per RESEARCH Open Question 3>
- **Job posting used:** <TBD>
- **Same-day `recall()` result:** <TBD: pass | fail>
- **Next-day fresh-conv `recall()` result:** <TBD: pass | fail>
- **Result:** [pending]
- **Agent capture excerpt:** <TBD>
- **Next-day recall excerpt:** <TBD>
- **Notes:** <TBD: any regression in the agent's pre-Engram capture flow, env state, observed semantics>

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

<!-- Populate ONLY if a test fails. Each gap becomes a gap-closure planning input. -->
