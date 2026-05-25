---
status: partial
phase: 01-foundation
source: [01-VERIFICATION.md]
started: 2026-05-25T22:00:00Z
updated: 2026-05-25T22:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. README portfolio quality on GitHub
expected: All three badges render live (Apache-2.0 blue, CI green, version 0.1.0-alpha), Mermaid architecture diagram renders inline as a flowchart, all internal links resolve (LICENSE, CLAUDE.md, ROADMAP.md, docs/architecture.svg).
result: [pending]

### 2. CI workflow first-push run goes green
expected: `.github/workflows/ci.yml` runs all 11 steps to completion on push to `main` and on PRs (checkout → setup-node → npm ci → types:gen → typecheck → lint → format:check → lint:wrangler → FND-08 negative-fixture → FND-08 positive-fixture → smoke mcp-server → smoke triage-worker → smoke install). Expected runtime ~90s on ubuntu-latest.
result: [pending]

### 3. LICENSE renders on GitHub with v1.0 confirmation header
expected: Opening LICENSE on github.com/<owner>/engram shows "NOTICE: Engram is licensed under Apache License 2.0." on line 1 and "subject to final confirmation at v1.0." on line 2, followed by the standard Apache-2.0 text. GitHub's license badge still detects Apache-2.0.
result: [pending]

### 4. CONTRIBUTING.md unchanged on GitHub
expected: GitHub shows CONTRIBUTING.md as byte-identical to the pre-Phase-1 GSD-setup stub (D-16 compliance — full contributor guidance deferred to v1.0).
result: [pending]

### 5. README owner-TODO cleanup decision (REVIEW IN-02 deferred Info)
expected: After first push confirms GitHub owner is `russellkmoore`, decide whether to remove the `<!-- TODO: confirm owner after first push -->` HTML comment on README.md:1. The badge URL on line 4 already uses the confirmed owner — the TODO is now stale.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
