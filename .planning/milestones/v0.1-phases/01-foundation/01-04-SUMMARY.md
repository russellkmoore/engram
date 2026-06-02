---
phase: 01-foundation
plan: "04"
subsystem: shared-packages
tags: [shared-packages, types, schema, system-memory-types, FND-04, FND-05]
dependency_graph:
  requires:
    - root-package-json (01-01)
    - tsconfig-base (01-01)
    - eslint-flat-config (01-01)
  provides:
    - engram-types-package
    - engram-schema-package
    - system-memory-type-seed
  affects:
    - packages/mcp-server (imports @engram/types, @engram/schema in 01-05)
    - packages/triage-worker (imports @engram/types in 01-05)
    - packages/workspace-do (Phase 2 migration consumes SYSTEM_TYPES)
tech_stack:
  added: []
  patterns:
    - Pattern S1 (workspace package TS-source exports via D-07)
    - Pattern S3 (per-package tsconfig extending tsconfig.base.json)
    - as const satisfies pattern for typed SYSTEM_TYPES array
key_files:
  created:
    - shared/types/package.json
    - shared/types/tsconfig.json
    - shared/types/src/index.ts
    - shared/schema/package.json
    - shared/schema/tsconfig.json
    - shared/schema/src/index.ts
    - shared/schema/src/system-types.ts
  modified: []
decisions:
  - "D-07 enforced: both packages export TS source directly via exports field (no build step)"
  - "D-06 enforced: @engram/types and @engram/schema in @engram/* scope"
  - "T-01-12 mitigated: Event renamed to TimelineEvent to avoid DOM globals collision in Workers"
  - "T-01-13 accepted: embedding_model/embedding_version excluded from v0.1 Memory type"
  - "ESLint consistent-type-definitions rule auto-converted export type to export interface for object shapes"
metrics:
  duration_seconds: 290
  completed_date: "2026-05-25"
  tasks_completed: 2
  files_created: 7
  files_modified: 0
---

# Phase 1 Plan 04: Shared Packages (@engram/types + @engram/schema) Summary

**One-liner:** npm workspace packages @engram/types and @engram/schema export TypeScript source directly via the exports field, providing 5 v0.1 shared types (FND-04) and 7 seeded system memory type definitions (FND-05) for all downstream Worker consumers.

## What Was Built

Two shared workspace packages establishing the **shared-package pattern (Pattern S1)** that all v0.1 Workers consume in Plan 05.

### Files Created

| File                                | Purpose                                                      | Key Exports / Contents                                                              |
| ----------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `shared/types/package.json`         | `@engram/types` workspace manifest, TS-source exports field  | `name: "@engram/types"`, `exports["."].types: "./src/index.ts"`                     |
| `shared/types/tsconfig.json`        | Per-package tsconfig extending root base                     | `extends: "../../tsconfig.base.json"`                                               |
| `shared/types/src/index.ts`         | 5 FND-04 shared types (238 lines)                            | `MemoryEvent`, `Memory`, `Entity`, `TimelineEvent`, `Conflict`, `EngramResponse<T>` |
| `shared/schema/package.json`        | `@engram/schema` workspace manifest, TS-source exports field | `name: "@engram/schema"`, `exports["."].types: "./src/index.ts"`                    |
| `shared/schema/tsconfig.json`       | Per-package tsconfig extending root base                     | `extends: "../../tsconfig.base.json"`                                               |
| `shared/schema/src/index.ts`        | Barrel re-export                                             | `export * from "./system-types.js"`                                                 |
| `shared/schema/src/system-types.ts` | 7 system memory types with field metadata (244 lines)        | `FieldType`, `FieldDefinition`, `SystemMemoryType`, `SYSTEM_TYPES`                  |

### Exported Types (@engram/types)

| Type                | Shape Source                             | Notes                                                                                     |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `MemoryEvent`       | CLAUDE.md §"MemoryEvent" verbatim        | `context?` typed as `Record<string, unknown>` (strict-mode safe equivalent of `object`)   |
| `Memory`            | Mirrors `blocks` SQLite table            | `embedding_model`/`embedding_version` intentionally excluded (Phase 2 STO-04 widens type) |
| `Entity`            | Conservative v0.1 minimal shape          | Full entity model (aliases, confidence) lands in Phase 2/5                                |
| `TimelineEvent`     | Renamed from CLAUDE.md's `Event`         | DOM `Event` collision avoidance (T-01-12 mitigation) — see Deviations                     |
| `Conflict`          | Mirrors `conflicts` SQLite table         | `severity: "low" \| "medium" \| "high"` union                                             |
| `EngramResponse<T>` | CLAUDE.md §"Universal Response Envelope" | Generic; `context.timeline: TimelineEvent[]` uses renamed type                            |

### System Memory Types (@engram/schema — FND-05)

| Type ID           | Display Name    | Field Count | Required Fields |
| ----------------- | --------------- | ----------- | --------------- |
| `job_application` | Job Application | 8           | company, role   |
| `contact`         | Contact         | 6           | name            |
| `company`         | Company         | 5           | name            |
| `project`         | Project         | 5           | name            |
| `research_note`   | Research Note   | 5           | title           |
| `decision_log`    | Decision Log    | 5           | decision        |
| `meeting_note`    | Meeting Note    | 5           | date            |

Total: **7 types**, **39 field definitions**, `FieldType` union covering all 9 supported types (`text`, `number`, `date`, `url`, `select`, `multi_select`, `boolean`, `relation`, `range`).

### SYSTEM_TYPES Implementation

`SYSTEM_TYPES` is exported as `as const satisfies readonly SystemMemoryType[]` to:

1. Preserve literal types on `id`, field `type`, and `options` values (enables exhaustive switch narrowing in future phases)
2. Validate at compile time that every entry conforms to `SystemMemoryType`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - ESLint auto-conversion] `export type` → `export interface` for object shapes in @engram/types**

- **Found during:** Task 1 commit (pre-commit ESLint hook ran `--fix`)
- **Issue:** The plan specified `export type` for all 5 types to satisfy `consistent-type-imports`. However, the ESLint `stylisticTypeChecked` ruleset from Plan 01 includes `@typescript-eslint/consistent-type-definitions: ["error", "interface"]` which auto-converts object-shape `type` aliases to `interface` declarations.
- **Fix:** ESLint auto-fixed all object-shape declarations to `interface`. This is the **correct behavior** per the Plan 01 toolchain lock (D-01/D-02). `EngramResponse<T>` became `export interface EngramResponse<T>` (still generic and exported).
- **Impact:** The plan's acceptance criterion `grep -qE "export type ${t}\b"` will not match for `MemoryEvent`, `Memory`, `Entity`, `Conflict`, `TimelineEvent`. However, `grep -qE "export (type|interface) ${t}\b"` correctly matches all 5 — the semantic requirement (all types exported and correctly typed) is fully satisfied. The grep pattern in the plan was written assuming `export type` without accounting for the ESLint rule.
- **Files modified:** `shared/types/src/index.ts`
- **Commit:** `775e75d`

**2. [Note] Acceptance criterion grep for `Conflict.severity` uses single-quote pattern**

- The plan's acceptance criterion `grep -qE "'low'\\s*\\|\\s*'medium'\\s*\\|\\s*'high'"` looks for single-quoted string literals. Prettier config `singleQuote: false` enforces double quotes, so the actual source has `"low" | "medium" | "high"`. The union is semantically and syntactically correct; only the acceptance-criterion grep pattern is mismatched with the toolchain config. The double-quote equivalent grep `grep -qE '"low"\s*\|\s*"medium"\s*\|\s*"high"'` passes.
- **Files modified:** None (no code change needed)

**3. [Rule 1 - Bug] Acceptance criterion `"id": "job_application"` JSON-format grep does not match TypeScript object literal format**

- The plan's automated verify in Task 2 checks `s.includes('"id": "'+t+'"')` which looks for JSON-style quoted key `"id":`. TypeScript object literals use unquoted keys: `id: "job_application"`. The node verify command was adapted to correctly check `s.includes('"'+t+'"')` which matches the string value. The plan's static grep pattern `grep -cE '^\s*\{\\s*id:' shared/schema/src/system-types.ts` correctly uses unquoted `id:` syntax — the issue was only in the node one-liner. All 7 system types are present and confirmed by `node --experimental-strip-types` runtime check returning `SYSTEM_TYPES.length === 7`.

### Intended Deviations (Not Auto-fixed)

**T-01-12 — Event → TimelineEvent rename**

As specified in the plan's threat model: `CLAUDE.md §"Universal Response Envelope"` uses `Event[]` for `context.timeline`, but `Event` collides with the DOM `Event` global in Cloudflare Workers (which expose DOM types). The type was renamed to `TimelineEvent` with an explanatory comment, as required by T-01-12. This is a deliberate divergence from the CLAUDE.md literal.

**T-01-13 — Phase-2 fields excluded from v0.1 Memory**

`embedding_model: string | null` and `embedding_version: number | null` are intentionally absent from the v0.1 `Memory` type. Phase 2's STO-04 migration adds these columns and will widen the type at that time.

## Known Stubs

None. Both packages are complete scaffold-only packages — no business logic exists yet (by design, Phase 1 establishes scaffolding only). The `SYSTEM_TYPES` array is real seed data, not a stub; it will be consumed by Phase 2's WorkspaceDO seed migration.

## Threat Surface Scan

No new security surface introduced. Both packages are static TypeScript type definitions and data constants with no network endpoints, auth paths, file access, or schema changes at trust boundaries. The threat mitigations from the plan's threat register are applied:

| Threat                           | Mitigation Applied                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| T-01-12 DOM Event collision      | `TimelineEvent` used throughout; comment documents the rename rationale             |
| T-01-13 Premature Phase-2 fields | `Memory` type excludes `embedding_model`/`embedding_version`                        |
| T-01-14 Wrong moduleResolution   | Both tsconfigs extend `tsconfig.base.json` which sets `moduleResolution: "bundler"` |
| T-01-15 Field metadata drift     | All 7 CLAUDE.md type IDs present; all 9 FieldType values covered                    |

## Self-Check

Files created:

- [x] `shared/types/package.json` — FOUND
- [x] `shared/types/tsconfig.json` — FOUND
- [x] `shared/types/src/index.ts` — FOUND
- [x] `shared/schema/package.json` — FOUND
- [x] `shared/schema/tsconfig.json` — FOUND
- [x] `shared/schema/src/index.ts` — FOUND
- [x] `shared/schema/src/system-types.ts` — FOUND

Commits:

- [x] `775e75d` — feat(01-04): scaffold @engram/types with 5 v0.1 shared types (FND-04)
- [x] `4554bc5` — feat(01-04): scaffold @engram/schema with 7 system memory types (FND-05)

Runtime verification:

- [x] `node -e "require('./shared/types/package.json'); require('./shared/schema/package.json')"` exits 0
- [x] `node --experimental-strip-types` import of `SYSTEM_TYPES` returns `.length === 7`
- [x] All 5 FND-04 types exported (as `interface` after ESLint auto-fix)
- [x] All 7 FND-05 system type IDs present in `system-types.ts`
- [x] All 9 `FieldType` values present in union

## Self-Check: PASSED
