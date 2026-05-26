/**
 * v1 initial schema DDL for the WorkspaceDO SQLite store.
 *
 * STUB: Plan 02-01 (migration runner) landed first and needed something to
 * import from this path so `npm run typecheck` would stay green. Plan 02-02
 * MUST overwrite this file with the real `V1_SQL` constant containing the
 * 7-table DDL block per `02-RESEARCH.md` §2 and CLAUDE.md §"SQLite Schema
 * (inside WorkspaceDO)" — including the two STO-04 columns
 * (`embedding_model TEXT`, `embedding_version INTEGER`) on `blocks` and the
 * aggressive v1 indexing per D-04 / D-05.
 *
 * Do NOT consume this stub elsewhere — it is a placeholder, not a contract.
 *
 * @module @engram/workspace-do/schema
 */

// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- explicit `string` keeps the contract visible to migration runner and to Plan 02-02's overwrite.
export const V1_SQL: string = "";
