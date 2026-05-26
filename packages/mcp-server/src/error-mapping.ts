/**
 * `mapToMcpError` — single exception → McpError converter for all tool handlers.
 *
 * Cross-phase contract:
 * - **Phase 2 STO-07 pass-through:** when a `WorkspaceDO` method throws
 *   `McpError(-32600 InvalidRequest)` from `assertOwnsWorkspace`, the
 *   instance must reach the MCP client unchanged so the defense-in-depth
 *   error code semantics survive the tool boundary.
 * - **Phase 3 D-09 error convention:** `NotFoundError` (thrown by single-row
 *   `@engram/workspace-do` query helpers — `getBlock`, `getMemoryType`, etc.)
 *   maps to `McpError(-32602 InvalidParams)` — "the id you supplied doesn't
 *   exist".
 * - **Phase 4 (TOL-01..05):** tool handler bodies wrap their `WorkspaceDO`
 *   calls in `try { ... } catch (err) { throw mapToMcpError(err); }` so
 *   every uncaught exception is normalized to an MCP-shaped error before it
 *   crosses the trust boundary back to the client.
 *
 * Design notes (locked):
 * - Pass-through preserves `assertOwnsWorkspace`'s `McpError(-32600
 *   InvalidRequest)` from Phase 2 STO-07 unchanged (referential equality).
 * - `NotFoundError` → `InvalidParams (-32602)` per Phase 3 D-09 error-mapping
 *   convention. The original `NotFoundError.message` carries the discriminants
 *   (`${resource} not found: ${id}`) — no separate message construction here.
 * - Anything else → `InternalError (-32603)` with a sanitized message.
 *   Never leak stack traces, filesystem paths, or hex secrets to the client.
 * - `sanitize()` is file-local (NOT exported). The public surface is exactly
 *   one named export: `mapToMcpError`. No default export — matches the
 *   repo-wide convention (`packages/workspace-do/src/errors.ts` shape).
 * - The sanitize regexes are intentionally conservative for v0.1; tune in
 *   Phase 4 if a specific leak vector surfaces.
 *
 * Threat model:
 * - **T-03-LEAK (Information Disclosure)** — mitigated by `sanitize()`:
 *   - `/Users/...` filesystem paths → `<path>` (developer-machine artifacts)
 *   - 32+ char hex strings → `<hex>` (potential tokens / API keys / secrets)
 *   - Final 500-char truncation cap (bounded leakage even if both regexes miss)
 *
 * @module @engram/mcp-server/error-mapping
 */
// packages/mcp-server/src/error-mapping.ts
// Source: CONTEXT.md Claude's Discretion — centralized error convention.
// Phase 4 tool handlers import mapToMcpError; Phase 3 ships the helper so the
// shape is settled.
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { NotFoundError } from "@engram/workspace-do";

/**
 * Convert any thrown value into an `McpError` suitable for returning to an
 * MCP client. See the module-level JSDoc for the cross-phase contract.
 *
 * @param err the value caught from a `try { ... } catch (err) { ... }` block
 *   (typed `unknown` per TypeScript's strict catch-clause typing).
 * @returns an `McpError` — either the original instance (pass-through) or a
 *   newly constructed one with the appropriate `ErrorCode` and a sanitized
 *   message.
 */
export function mapToMcpError(err: unknown): McpError {
  // Pass through McpError unchanged (e.g., assertOwnsWorkspace's
  // McpError(InvalidRequest) from Phase 2 STO-07).
  if (err instanceof McpError) {
    return err;
  }

  // NotFoundError → InvalidParams (-32602): "the id you supplied doesn't exist".
  if (err instanceof NotFoundError) {
    return new McpError(ErrorCode.InvalidParams, err.message);
  }

  // Anything else → InternalError (-32603) with sanitized message.
  // Never leak stack traces, DB internals, or env values.
  const message = err instanceof Error ? err.message : "Internal error";
  return new McpError(ErrorCode.InternalError, sanitize(message));
}

/**
 * File-local sanitizer that strips patterns most likely to leak secrets or
 * internal paths from an arbitrary `Error.message` string. Intentionally NOT
 * exported — `mapToMcpError` is the single public surface.
 *
 * Pipeline (run in order, then truncate):
 *   1. `/Users/<anything-non-whitespace>` → `<path>` (developer-machine paths)
 *   2. 32+ contiguous lowercase hex chars → `<hex>` (token / hash leakage)
 *   3. `.slice(0, 500)` — bounded leakage even if both regexes miss.
 */
function sanitize(message: string): string {
  // Strip patterns that could leak secrets or internal paths.
  // v0.1 conservative pass; tune if Phase 4 surfaces specific leak vectors.
  return message
    .replace(/\/Users\/[^\s]+/g, "<path>")
    .replace(/[a-f0-9]{32,}/g, "<hex>")
    .slice(0, 500);
}
