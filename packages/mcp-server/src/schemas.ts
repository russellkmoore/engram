/**
 * Zod input schemas for the 5 v0.1 MCP tools.
 *
 * Single source of truth (D-06) — Phase 4 handler bodies import these for
 * type-only checks, but DO NOT call `.parse()` (the SDK auto-validates via
 * `registerTool({ inputSchema }, cb)` before the handler ever runs).
 *
 * Cross-phase contract:
 * - **Phase 2 STO-07 / Phase 3 MCP-05:** the structural defense-in-depth
 *   invariant is enforced by the `//`-comment header below + the structural
 *   assertions in `src/__tests__/schemas.test.ts` (see header for details).
 * - **Phase 4 (TOL-01..05):** tool handler bodies `import type { ... }` the
 *   corresponding `XxxInput` type aliases below and read the workspace
 *   exclusively from `this.props` (JWT-derived), NEVER from tool input.
 *
 * Design notes (locked):
 * - Hand-written zod (D-06 + Phase 1 D-07) — no zod-to-ts / ts-to-zod build
 *   step; the TS-source / no-build posture stays intact.
 * - `z.infer<typeof X>` aliases for callers needing the parsed-output type.
 * - Schema field order mirrors `@engram/types` canonical shapes where they
 *   overlap (content/query/id/source first), which keeps the downstream
 *   handler `args` destructuring readable.
 * - Each schema's primary required field carries `.min(1)` so empty-string
 *   inputs are rejected at the zod layer before any handler runs.
 *
 * The load-bearing contract phrase appears ONLY in the `//`-comment block
 * directly below this JSDoc (so the structural grep — which strips `//`
 * line comments before scanning for the contract field name — returns
 * zero matches).
 *
 * @module @engram/mcp-server/schemas
 */
// packages/mcp-server/src/schemas.ts
// Source: D-06 — single source of truth for tool input shapes.
//         The zod schemas mirror @engram/types shapes where possible.
//
// CRITICAL DEFENSE-IN-DEPTH CONTRACT (MCP-05 / Phase 2 STO-07):
// NONE of these schemas declares a `workspace_id` field. The workspace
// is derived from the JWT's `this.props.workspace_id` at the handler level,
// NEVER from tool input. A future contributor adding `workspace_id` to any
// schema below is breaking the defense-in-depth invariant.

import { z } from "zod";

// remember(content, type?, project?, tags?, source?, expires?)
export const RememberInputSchema = z.object({
  content: z.string().min(1),
  type: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  expires: z.iso.datetime().optional(),
});
export type RememberInput = z.infer<typeof RememberInputSchema>;

// recall(query, types?, project?, scope?, limit?, since?, until?, verbosity?)
export const RecallInputSchema = z.object({
  query: z.string().min(1),
  types: z.array(z.string()).optional(),
  project: z.string().optional(),
  scope: z.enum(["personal", "project", "org"]).optional(),
  limit: z.number().int().positive().max(25).optional(), // D-10 (was max(100))
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  // D-01 (Phase 5): default = "chunks" — synthesis is opt-in per recall-latency budget (2–5s LLM tax).
  // Phase 4 D-03 was "both"; Phase 5 supersedes per CONTEXT.md D-01. Discoverability triad (tool description + meta.gaps + suggestions.actions) lands in Plan 05-05.
  verbosity: z.enum(["synthesis", "chunks", "both"]).optional().default("chunks"),
});
export type RecallInput = z.infer<typeof RecallInputSchema>;

// search(query, filters, limit?)
export const SearchInputSchema = z.object({
  query: z.string().min(1),
  filters: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().positive().max(25).optional(), // D-10 (new field — Phase 3 had no limit)
});
export type SearchInput = z.infer<typeof SearchInputSchema>;

// forget(id, cascade?)
export const ForgetInputSchema = z.object({
  id: z.string().min(1),
  cascade: z.boolean().optional(),
});
export type ForgetInput = z.infer<typeof ForgetInputSchema>;

// ingest(source, type?, project?, priority?, threshold?)
export const IngestInputSchema = z.object({
  source: z.string().min(1),
  type: z.string().optional(),
  project: z.string().optional(),
  priority: z.enum(["fast", "deep"]).optional(),
  threshold: z.number().min(0).max(1).optional(),
});
export type IngestInput = z.infer<typeof IngestInputSchema>;
