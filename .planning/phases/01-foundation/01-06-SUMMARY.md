---
phase: 01-foundation
plan: "06"
subsystem: ci-dx-readme
status: checkpoint-paused
tags: [ci, github-actions, readme, portfolio, svg, setup-script]
requirements_addressed: [FND-01, FND-03, FND-08]
depends_on: ["01-01", "01-02", "01-03", "01-04", "01-05"]
dependency_graph:
  requires: [01-01, 01-02, 01-03, 01-04, 01-05]
  provides: [ci-workflow, readme, architecture-svg]
  affects: [all-future-phases]
tech_stack:
  added:
    - "@mermaid-js/mermaid-cli@11.15.0 (one-time SVG render, not committed to devDeps)"
  patterns:
    - "GitHub Actions CI: checkout → setup-node(nvmrc) → npm ci → types:gen → typecheck → lint → format:check → lint:wrangler → smoke(mcp) → smoke(triage) → smoke(install)"
    - "README: 3 shields.io badges + Mermaid flowchart + 10 D-13 sections"
    - "Mermaid-rendered SVG in docs/ for hero/social-share image"
key_files:
  created:
    - .github/workflows/ci.yml
    - README.md
    - docs/architecture.svg
  modified:
    - package.json (setup script reminder line)
  deleted:
    - scripts/setup-dev.sh
decisions:
  - "Deleted scripts/setup-dev.sh (not shimmed): content already in CONTRIBUTING.md per D-16; package.json setup script prints pointer instead"
  - "SVG rendered with @mermaid-js/mermaid-cli@11.15.0 — simplified Mermaid source (no <br/> in node labels) to avoid Mermaid CLI parse error with direction TB + HTML labels"
  - "CI badge owner: russellkmoore (from git remote URL) with <!-- TODO --> comment for post-push confirmation per plan instruction"
  - "Mermaid diagram uses simplified labels (no <br/> HTML tags) — the verbatim RESEARCH diagram with <br/> caused mmdc parse failure; simplified version is structurally equivalent"
metrics:
  completed_date: "2026-05-25"
  duration_seconds: 424
  tasks_completed: 3
  tasks_total: 4
  tasks_paused_at: 4
  files_created: 3
  files_modified: 1
  files_deleted: 1
---

# Phase 01 Plan 06: CI, README, and Setup Script Summary

**Status: PAUSED at checkpoint (Task 4 — human-verify)**

One-liner: GitHub Actions 11-step CI pipeline, portfolio-quality README with Mermaid diagram and 3 badges, polished SVG hero image, and setup-dev.sh retired.

---

## Tasks Completed

| Task | Name                                     | Commit  | Files                                        |
| ---- | ---------------------------------------- | ------- | -------------------------------------------- |
| 1    | Create .github/workflows/ci.yml          | 86e95e0 | .github/workflows/ci.yml                     |
| 2    | Retire scripts/setup-dev.sh              | fbd5210 | scripts/setup-dev.sh (deleted), package.json |
| 3    | Create README.md + docs/architecture.svg | 1a44b57 | README.md, docs/architecture.svg             |

---

## Task Details

### Task 1: .github/workflows/ci.yml

Created the GitHub Actions CI workflow per RESEARCH §Pattern 10 with three additional smoke steps:

- Triggers: `push` and `pull_request` to `main` (D-03 durable gate)
- 11 steps: checkout → setup-node@v4 (nvmrc, npm cache) → npm ci → types:gen → typecheck → lint → format:check → lint:wrangler (FND-08) → smoke mcp-server → smoke triage-worker → smoke install
- Step ordering invariants enforced: `types:gen` before `typecheck` (Pitfall 7); `smoke-install.sh` last (preserves npm ci cache)
- Both Worker wrangler configs referenced explicitly

### Task 2: scripts/setup-dev.sh retired

Decision: **Deleted** (not shimmed). Rationale:

- The 4-line `echo` content (GSD plugin install steps) already lives in `CONTRIBUTING.md` (D-16 keeps as-is)
- Root `package.json` `setup` script already runs `npm install && npm run types:gen` (Pattern 5)
- Added a one-line stdout reminder to the `setup` script: `"node -e \"console.log('...')\" && npm install && npm run types:gen"`
- CONTRIBUTING.md unchanged (D-16 compliance verified: `git diff --quiet CONTRIBUTING.md` exits 0)

### Task 3: README.md + docs/architecture.svg

README.md (140 lines):

- **Section 1:** 3 badges only (D-15): Apache-2.0 (shields.io), CI status (github.com/actions/workflows/ci.yml), version (0.1.0-alpha)
- **Section 2:** Title + tagline
- **Section 3:** Why Engram — no-memory problem + the Notion inversion
- **Section 4:** Architecture — Mermaid flowchart LR block (GitHub renders natively per D-14)
- **Section 5:** Tech Stack table (9 layers from CLAUDE.md)
- **Section 6:** Status — v0.1 MCP Foundation in progress, Phase 2 next
- **Section 7:** Getting Started — npm install, typecheck+lint verification, dev:mcp/dev:triage
- **Section 8:** Architecture Deep Dive link to CLAUDE.md (D-13 section 7)
- **Section 9:** License footer with LICENSE link and v1.0 provisional note

docs/architecture.svg (37,749 bytes):

- Rendered with `@mermaid-js/mermaid-cli@11.15.0` (latest stable; T-01-26 supply-chain note: one-time render, SVG is committed, runtime no longer depends on mermaid-cli)
- Used simplified node labels (removed `<br/>` HTML tags from verbatim RESEARCH diagram — these caused a parse error in mmdc with `direction TB` subgraphs)
- Background: transparent; theme: default — matches GitHub Mermaid default for both light/dark themes
- SVG starts with `<svg` and is 37KB with valid content

---

## Deviations from Plan

### Auto-fixed Issues

None.

### Design Decisions Made

**1. Mermaid diagram simplified (not verbatim RESEARCH block)**

- **Found during:** Task 3, SVG render attempt
- **Issue:** The verbatim RESEARCH §System Architecture Diagram uses `<br/>` HTML inside node labels (e.g., `ROOT[package.json<br/>workspaces field<br/>scripts: lint, typecheck,<br/>lint:wrangler, prepare]`). When combined with `direction TB` inside subgraphs, `@mermaid-js/mermaid-cli@11.15.0` throws a parse error: `Expecting 'SEMI', 'NEWLINE'...got 'LINK_ID'`.
- **Fix:** Replaced `<br/>` multi-line labels with single-line dash-separated labels (e.g., `ROOT["package.json - workspaces, scripts"]`). The diagram structure, nodes, edges, and subgraph topology are identical.
- **Impact:** README Mermaid block and docs/architecture.svg both use the simplified version. They are consistent with each other (D-14 allows slight theme/content divergence between them).

**2. setup-dev.sh deleted (not shimmed)**

- **Decision:** Deleted per RESEARCH Q1 recommendation. 4-line echo content already in CONTRIBUTING.md; no external links to the script found.
- **Fallback not triggered:** No documented external link would break.

---

## Known Stubs

None — no hardcoded empty values or placeholder text in created files that would prevent the plan's goal.

---

## Threat Flags

None — no new security-relevant surface introduced beyond what the plan's threat model covers (CI workflow and README are public-facing but non-executable; SVG is a static asset).

---

## Checkpoint: Task 4 (human-verify)

**Status: PAUSED — awaiting human verification**

Tasks 1-3 are committed. The automation is complete. The human must now:

1. Push the branch to GitHub
2. Verify the CI workflow runs green
3. Verify the README renders correctly on GitHub (badges live, Mermaid inline, links resolve)
4. Verify LICENSE file has the v1.0 confirmation header
5. Verify CONTRIBUTING.md is unchanged

See checkpoint return message for the full 5-step checklist.

---

## Self-Check

### Files Exist

- [x] `.github/workflows/ci.yml` — commit 86e95e0
- [x] `README.md` — commit 1a44b57
- [x] `docs/architecture.svg` — commit 1a44b57
- [x] `scripts/setup-dev.sh` deleted — commit fbd5210

### Commits Verified

- 86e95e0 — feat(01-06): create GitHub Actions CI workflow
- fbd5210 — chore(01-06): retire scripts/setup-dev.sh, update npm run setup reminder
- 1a44b57 — feat(01-06): add portfolio-quality README and architecture SVG

## Self-Check: PASSED (Tasks 1-3; Task 4 is checkpoint-blocked)
