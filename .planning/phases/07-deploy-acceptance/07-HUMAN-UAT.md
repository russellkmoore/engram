---
status: complete
phase: 07-deploy-acceptance
source: [REQUIREMENTS.md#DEP-03]
captured_by: russell
started: 2026-05-30T03:09:11Z
updated: 2026-05-30T17:30:00Z
---

# Phase 7 HUMAN-UAT — Deploy + Acceptance

> Created as an empty skeleton at plan-execute time per CONTEXT.md D-04 + planning_context Key Finding #5.
> Russell populated each test entry's `Result:` field across the 2026-05-30 acceptance window.
> DEP-03 PASSED on both runs (Apple + Anthropic postings, ~9h wall-clock waits, fresh-session recalls). DEP-04 dropped from v0.1 scope by operator decision during execution.

## Current Test

[testing complete]

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

### Run 1: 2026-05-30

- **DEP ID:** DEP-03
- **Expected:** In a fresh Claude Desktop chat session (conv B, no shared history with the conv that performed the `remember`), asking "what job posting did I save earlier?" causes Claude to call `recall` against Engram and return the posting with extracted fields (URL + company + role) intact.
- **Conv A action:** `remember()` the Apple ML Research Scientist posting via Claude Desktop.
- **Job posting used (conv A):** Machine Learning Research Scientist – Health AIML at Apple — `https://jobs.apple.com/en-us/details/200665930-3337/machine-learning-research-scientist-health-aiml?team=MLAI`
- **Wait duration:** ~9 hours 30 minutes (well past the ≥60-minute DEP-03 minimum). Conv A 00:38 PT → conv B 10:08 PT.
- **Conv B action:** Fresh Claude Desktop chat → "do you recall what job postings we remembered in engram?"
- **Same-conv `recall()` smoke (RESEARCH §Pitfall 7 mitigation):** **pass** — earlier "use engram to recall test" in conv A's session returned block `441b66ff` (the seed "test" entry from the bootstrap smoke). Confirmed write side works before the long wait.
- **Result:** **[pass]**
- **Conv A excerpt:** "remember this job posting: Machine Learning Research Scientist - Health AIML - `https://jobs.apple.com/en-us/details/200665930-3337/...`" → Claude: "Saved (ID `34ee3009`, classified as `job_application`). Role / Company / Team / Req ID / URL captured. Apple's JS-heavy job page didn't fully render through fetch, so the full description didn't load — metadata captured from the URL + posting title."
- **Conv B excerpt:** Claude: "Yes — two job postings are saved in engram: (1) Machine Learning Research Scientist – Health AIML at Apple — Team: MLAI (Machine Learning and AI), Requisition ID: 200665930-3337..." All structured fields (company, team, req ID, URL) returned intact.
- **Notes:** Conv B was a single recall that satisfied BOTH Run 1 + Run 2 (Russell asked broadly "what postings did I save?" and Claude returned both). That's acceptable per DEP-03 — the requirement is fresh-session + ≥60-min wait, both met. One v0.2 follow-up surfaced in conv B: Claude flagged a "parse error on the job_application type" on the Apple record. Type WAS classified correctly at write time per conv A's output; symptom is in the recall envelope shape, not in storage. Recall data itself returned correctly. Not blocking.

### Run 2: 2026-05-30 (same day, different posting)

- **DEP ID:** DEP-03
- **Expected:** Same shape as Run 1 but with a **different** job posting (different role + company + URL) to exercise Vectorize semantic recall, not memoization of Run 1's content.
- **Conv A action:** `remember()` the Anthropic TPM posting via Claude Desktop.
- **Job posting used (conv A):** Technical Program Manager, Inference Performance at Anthropic — `https://job-boards.greenhouse.io/anthropic/jobs/5107763008` (different role + company + URL from Run 1's Apple posting ✓)
- **Wait duration:** ~9 hours 6 minutes (well past the ≥60-minute DEP-03 minimum). Conv A 01:02 PT → conv B 10:08 PT.
- **Conv B action:** Same fresh chat as Run 1 conv B (the broad "what postings did I save?" query covered both runs).
- **Same-conv `recall()` smoke (RESEARCH §Pitfall 7 mitigation):** N/A (conv A side verified working in Run 1; Run 2 conv A's auto-enrichment confirmed via Claude's response: salary range, locations, visa sponsorship, role focus all extracted from the greenhouse posting)
- **Result:** **[pass]**
- **Conv A excerpt:** "remember this job posting: Technical Program Manager, Inference Performance and Anthropic..." → Claude: "Saved cleanly to engram. Technical Program Manager, Inference Performance — Anthropic. Locations: San Francisco, CA or Seattle, WA (hybrid, ≥25% in-office). Salary: $290,000–$365,000 USD. Visa sponsorship: available. Focus: bridge between inference systems and the broader org... This one classified properly as a `job_application`."
- **Conv B excerpt:** Claude (10:08 AM): "2. Technical Program Manager, Inference Performance at Anthropic — Locations: San Francisco, CA or Seattle, WA (hybrid, in-office ≥25% of the time). Salary: $290,000–$365,000 USD, visa sponsorship available. Role bridges inference systems and the broader org... Bachelor's degree or equivalent; rolling applications, no deadline."
- **Notes:** Auto-enrichment via the Triage Worker performed strongly on this run — greenhouse.io page rendered fully (unlike Apple's JS app in Run 1), so location/salary/visa/fit signals were extracted and persisted. PIP-04 (entity extraction + summarization + memorability scoring) demonstrably working in production. Classification clean per `job_application`. No "type parse error" on this record per conv B observation (only the Apple Run 1 record had the inconsistency).

### ~~Rewire smoke (DEP-04)~~ — DROPPED from Phase 7 scope (2026-05-30)

DEP-04 was dropped from Phase 7 scope by operator decision during execution. Rationale: rewiring the existing job-search agent (Job Scout) to use Engram as its memory backend requires a real rewrite of that agent (separate codebase / separate project), not an in-place capture-path swap as originally scoped. Russell does not want Phase 7's acceptance window to depend on changes to that external project.

Engram's substrate readiness for any future agent rewire is already verified via DEP-03 — Russell's `remember()` calls from Claude Desktop round-trip through Engram and recall correctly across sessions. The agent-side rewire (whenever it happens) will exercise the SAME MCP tool surface that DEP-03 exercised; no additional Engram-side work is required to enable it.

REQUIREMENTS.md DEP-04 amended in the same commit that records this drop. Not tracked as a separate Linear issue — when Russell rewrites Job Scout, that work lives in the Job Scout repo's own backlog.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0
dropped: 1 (DEP-04 — out of Phase 7 scope per operator decision 2026-05-30)

## Gaps

<!-- Populate ONLY if a test fails. Each gap becomes a gap-closure planning input. -->
