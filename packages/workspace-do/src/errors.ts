/**
 * Domain errors thrown by `@engram/workspace-do` query helpers.
 *
 * Currently the only error class is `NotFoundError`, thrown by single-row
 * helpers (`getBlock`, `getMemoryType`, etc. — Plan 02-05) when no row matches
 * the requested id. List helpers (Plan 02-05) return `[]` on no matches and
 * do NOT throw. This is D-02 from `.planning/phases/02-workspacedo-sqlite/02-CONTEXT.md`
 * — JS-idiomatic try/catch wins over a `Result<T, E>` envelope at v0.1 scale.
 *
 * Cross-phase contract: Phase 3's MCP tool boundary catches `NotFoundError`
 * and re-throws as `McpError(-32602 InvalidParams)` — see PATTERNS.md
 * "Cross-Phase Drift Surface". The two discriminants (`resource`, `id`) give
 * Phase 3 the information it needs to construct a descriptive MCP error message
 * without having to parse this class's `message` string.
 *
 * Design notes (locked — PATTERNS.md §7 drift-risk callouts):
 * - NO `cause: unknown` field. Out of scope at v0.1; revisit when Phase 3
 *   actually needs to chain a downstream error.
 * - NO static factory methods (e.g., `NotFoundError.forBlock(id)`). The
 *   two-arg constructor is already the minimum viable surface; factories add
 *   indirection without value.
 * - `this.name = "NotFoundError"` is set explicitly after `super(...)` so
 *   `instanceof`-style narrowing and serialized error shape survive cross-realm
 *   boundaries (worker isolate ↔ host, structured-clone, etc.).
 *
 * @module @engram/workspace-do/errors
 */

export class NotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly id: string,
  ) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}
