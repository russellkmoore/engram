---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` §"Validation Architecture". Phase 1 is scaffold-only — validation is scripted smoke tests + lint + typecheck, not unit tests. `vitest` arrives in Phase 2.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (Phase 1). Scripted smoke + lint + typecheck. `vitest` lands in Phase 2 via `@cloudflare/vitest-pool-workers`. |
| **Config file** | none — Wave 0 installs `scripts/lint-wrangler.mjs`, `scripts/smoke-install.sh`, `scripts/smoke-wrangler-dev.sh` |
| **Quick run command** | `npm run lint && npm run typecheck && npm run lint:wrangler && npm run format:check` |
| **Full suite command** | Quick suite + `scripts/smoke-wrangler-dev.sh` (boots each Worker, 10s timeout, expects 200) + `scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc` (expects exit 1) |
| **Estimated runtime** | ~30s quick (warm install) / ~90s full (cold + smoke boots) |

---

## Sampling Rate

- **After every task commit:** Run `npm run lint && npm run typecheck && npm run lint:wrangler && npm run format:check`
- **After every plan wave:** Quick suite + `scripts/smoke-wrangler-dev.sh` for each Worker added in the wave
- **Before `/gsd:verify-work`:** Full suite must be green on a fresh clone in CI
- **Max feedback latency:** 30s per-task / 90s per-wave

---

## Per-Task Verification Map

> Populated by `/gsd:execute-phase` and `/gsd:verify-work` as tasks are created/executed. Planner ensures every task in `*-PLAN.md` has an `<automated>` verify command or declares a Wave 0 dependency.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-XX-YY | XX   | N    | FND-XX      | T-1-XX     | {behavior}      | smoke/lint/typecheck | `{command}` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/lint-wrangler.mjs` — implements FND-08 per RESEARCH §Pattern 8 (verbatim, jsonc-parser dep)
- [ ] `scripts/smoke-install.sh` — fresh-clone install smoke (FND-01); `rm -rf node_modules && npm install && ls -d node_modules/@engram/*`
- [ ] `scripts/smoke-wrangler-dev.sh` — `timeout 15 npx wrangler dev --config <path> --port 8787` per Worker, expects `curl -sf http://localhost:8787` to succeed (FND-03)
- [ ] `tests/fixtures/good-wrangler.jsonc` — mirrors RESEARCH §Pattern 1 (passes FND-08)
- [ ] `tests/fixtures/bad-wrangler.jsonc` — `new_classes: ["WorkspaceDO"]` (fails FND-08)
- [ ] `.github/workflows/ci.yml` — wires all quick-suite commands per RESEARCH §Pattern 10
- [ ] Root `tsconfig.json` + per-package `tsconfig.json` extending it (RESEARCH §Pattern 6)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README portfolio quality (elevator pitch, architecture diagram renders on GitHub, all three badges live) | D-13/D-14/D-15 (CONTEXT.md) | Visual judgment — automated tooling can confirm Mermaid parses + badge URLs resolve, but "portfolio quality" needs human review | Render README on a GitHub fork (or `gh pr view`); confirm Mermaid diagram renders, all three badges (license/CI/version) are green, hero SVG loads. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or declare a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers every script listed in `Wave 0 Requirements`
- [ ] No watch-mode flags in any verify command
- [ ] Feedback latency < 30s for quick suite
- [ ] `nyquist_compliant: true` set in frontmatter after planner completes

**Approval:** pending
