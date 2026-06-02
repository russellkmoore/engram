---
phase: 01-foundation
plan: 03
subsystem: documentation
tags: [claude-md, architecture-baseline, fnd-07, doc-drift-mitigation]
dependency_graph:
  requires: []
  provides: [FND-07, clean-architecture-baseline]
  affects: [Phase 2-7 agents reading CLAUDE.md as baseline]
tech_stack:
  added: []
  patterns: [verbatim-edit-map, surgical-line-anchored-edit]
key_files:
  modified:
    - CLAUDE.md
  created:
    - .planning/phases/01-foundation/01-03-SUMMARY.md
key_decisions:
  - CLAUDE.md updated to reflect wrangler.jsonc (not .toml), two-DO topology, agents/mcp McpAgent, search without format?, ingest-worker deferred to v0.4 — matches RESEARCH §Pattern 11 verbatim
metrics:
  duration: "~8 minutes"
  completed: "2026-05-25T18:49:25Z"
  tasks_completed: 2
  files_modified: 1
---

# Phase 1 Plan 3: CLAUDE.md Architecture Baseline Update Summary

**One-liner:** Six surgical edits + three additive paragraphs bring CLAUDE.md into alignment with v0.1 corrections (JSONC, two-DO topology, McpAgent, search without format?, ingest-worker deferred).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Verify current CLAUDE.md line anchors | (read-only) | CLAUDE.md (read) |
| 2 | Apply Pattern 11 edits (6 swaps + 3 additive paragraphs) | c845544 | CLAUDE.md |

## Task 1: Line Anchor Verification

All Pattern 11 anchors confirmed at exact lines documented in RESEARCH §Pattern 11 (2026-05-25):

| Target | Line Found | Text Confirmed |
|--------|-----------|----------------|
| `ingest-worker/` tree entry | 57 | `    ingest-worker/        # Ingest pipeline Worker — fetch, chunk, embed, store` |
| Root `wrangler.toml` | 71 | `  wrangler.toml           # Root Cloudflare config` |
| `search(query, filters, format?)` | 254 | `search(query, filters, format?)` |
| `export_url?` comment | 256 | `  // Returns: memories[], count, export_url? (if format specified)` |
| mcp-server `wrangler.toml` | 401 | `      wrangler.toml` |
| workspace-do `wrangler.toml` | 408 | `      wrangler.toml` |
| root scaffold `wrangler.toml` | 415 | `  wrangler.toml           # root config, DO bindings` |

## Task 2: Edits Applied

### Edit 1 — Repository Structure block, ingest-worker line (was L57)

**Before:**
```
    workspace-do/         # Durable Object — workspace actor, owns SQLite
    ingest-worker/        # Ingest pipeline Worker — fetch, chunk, embed, store
    triage-worker/        # Conflict detection + memorability scoring
```

**After:**
```
    workspace-do/         # Durable Object — workspace actor, owns SQLite
    triage-worker/        # Conflict detection + memorability scoring
```

**Additive annotation (outside closing fence, standalone markdown italic line):**
```
*Note: `ingest-worker` was an earlier design — folded into `triage-worker` for v0.1; reintroduced in v0.4 if connector volume warrants it.*
```

---

### Edit 2 — Root wrangler.toml line (was L71)

**Before:**
```
  wrangler.toml           # Root Cloudflare config
```

**After (inside same code block as tree-comment line):**
```
  # No root wrangler config — each Worker package owns its own wrangler.jsonc.
```

---

### Edit 3 — MCP tool surface `search` signature (was L254)

**Before:**
```
search(query, filters, format?)
  // Structured query with explicit filters
  // Returns: memories[], count, export_url? (if format specified)
```

**After:**
```
search(query, filters)
  // Structured query with explicit filters
  // Returns: memories[], count
  // Note: export(query, format, filters?) is a separate v0.3 tool — see Milestones.
```

---

### Edit 4 — v0.1 Scaffold Target, mcp-server wrangler reference (was L401)

**Before:** `      wrangler.toml`
**After:** `      wrangler.jsonc`

---

### Edit 5 — v0.1 Scaffold Target, workspace-do wrangler reference (was L408)

**Before:** `      wrangler.toml`
**After:** (line deleted — D-10: workspace-do is library-only, no wrangler config)

---

### Edit 6 — v0.1 Scaffold Target, second root wrangler reference (was L415)

**Before:** `  wrangler.toml           # root config, DO bindings`
**After:** (line deleted entirely)

---

### Additive Paragraph 1 — Session DO vs Workspace DO subsection

Inserted after "Durable Object Per Workspace" section (after "Project DOs are fully isolated" paragraph), before "SQLite Schema (inside WorkspaceDO)":

```markdown
### Session DO vs Workspace DO

Each Worker that hosts an MCP endpoint actually owns **two DO classes** declared in the same `wrangler.jsonc`:
- **`EngramMcp`** — auto-managed by `agents/mcp` `McpAgent`; holds transient MCP session state (per active client connection). Lifecycle: one DO instance per session, garbage-collected when the session ends.
- **`WorkspaceDO`** — durable, per-workspace, reached via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` after JWT validation. This is where the SQLite store lives.

Both are declared together under `migrations[0].new_sqlite_classes: ["EngramMcp", "WorkspaceDO"]`. SQLite-backed (not KV-backed) is irreversible per Cloudflare's migration rules.
```

---

### Additive Paragraph 2 — McpAgent annotation

Inserted in MCP Tool Surface section preamble (after "Nine tools maximum" line), before Core Tools subsection:

```markdown
The Worker uses `import { McpAgent } from "agents/mcp"` and serves via `EngramMcp.serve("/mcp")`. Do NOT use raw `@modelcontextprotocol/sdk` HTTP transports — they depend on `node:http` and will not run on `workerd`.
```

---

### Additive Paragraph 3 — ingest-worker deferred annotation

Inserted after Milestones table (after v1.0 row), before closing `---` separator:

```markdown
`ingest-worker` is **not** part of v0.1. The triage-worker consumes the Queue directly. The `ingest-worker` package returns in v0.4 when external connectors (Slack, Drive) need a general ingest orchestration layer.
```

## Acceptance Criteria Results

| Criterion | Status |
|-----------|--------|
| No `wrangler.toml` in CLAUDE.md | PASS |
| Original `ingest-worker/` tree entry gone (`! grep -E 'ingest-worker/\s*#.*Ingest pipeline'`) | PASS |
| `search(query, filters)` present | PASS |
| `search(query, filters, format?)` gone | PASS |
| `export_url?` comment gone | PASS |
| `Session DO vs Workspace DO` subsection present | PASS |
| `EngramMcp` present | PASS |
| `getAgentByName` present | PASS |
| `from "agents/mcp"` present | PASS |
| `workerd` present | PASS |
| `ingest-worker` v0.4 deferral noted | PASS |
| Tech Stack, Repository Structure, MCP Tool Surface, Milestones, Architecture sections intact | PASS |
| CONTRIBUTING.md not modified | PASS (file was not in worktree; no edits made to it) |

## Deviations from Plan

None — plan executed exactly as written. All 6 line-anchored edits and 3 additive paragraphs applied verbatim per RESEARCH §Pattern 11.

**Note on staleness grep:** The plan's RESEARCH Validation Architecture FND-07 row includes a grep `! grep -nE 'wrangler\.toml|ingest-worker[^/]|search\(query, filters, format\?\)' CLAUDE.md` as the canonical staleness check. After applying the edits, the two additive deferral paragraphs (which are required by Pattern 11) contain `ingest-worker` not followed by `/` — matching `ingest-worker[^/]`. This is expected and correct behavior: the original stale v0.1-active tree reference is gone; only the v0.4-context deferral notes remain. The plan's per-acceptance-criterion check `! grep -E 'ingest-worker/\s*#.*Ingest pipeline' CLAUDE.md` correctly passes.

## Threat Flags

None — no new network endpoints, auth paths, or security-relevant surface introduced. This plan modifies only documentation.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| CLAUDE.md exists | FOUND |
| 01-03-SUMMARY.md exists | FOUND |
| Commit c845544 exists | FOUND |
| wrangler.toml count in CLAUDE.md | 0 (expected 0) |
| wrangler.jsonc count in CLAUDE.md | 3 (expected >=1) |
| search(query, filters) count | 1 (expected 1) |
| EngramMcp count | 3 (expected >=1) |
| Session DO vs Workspace DO count | 1 (expected 1) |
