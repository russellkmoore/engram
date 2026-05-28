/**
 * `envelope` — EngramResponse<T> honest-stub builders + post-trim algorithm.
 *
 * Cross-phase contract:
 * - **Phase 2 STO-07 carry-forward:** `workspace_id` NEVER appears in any envelope
 *   field — that is a DO-side concern. The envelope is a read-only projection for
 *   the MCP client; DO handles all workspace routing.
 * - **Phase 3 D-04 (tool registrations stable):** This file is consumed by the
 *   5 tool handler bodies shipped in Plan 03. The public surface (8 named exports +
 *   META_GAPS const) is locked for Phase 4.
 * - **Phase 4 TOL-01..06 (5 honest-stub builders):** Every builder returns a
 *   fully-shaped `EngramResponse<T>` with all envelope fields PRESENT (even if
 *   null/empty). No AI-derived values in v0.1.
 * - **Phase 5 hand-off:** Phase 5 POPULATES `synthesis`, `entities`, `conflicts`,
 *   `meta.confidence`, `meta.coverage`, `meta.gaps` WITHOUT changing the envelope
 *   shape — body change, not contract change.
 *
 * Design notes (locked):
 * - D-04 (honest stubs): AI-requiring fields ship `null` or `[]`; NO templated
 *   heuristics. Phase 5 populates them with real CF AI values.
 * - D-06 (remember stub): `extracted_fields: {}`, `confidence: null` in v0.1.
 * - D-07 (recall stub): `synthesis: null` always in v0.1; `chunks` field present
 *   or absent (never present-with-undefined) based on `verbosity` parameter.
 * - D-08 (empty conflicts): `context.conflicts: []` on every builder in v0.1.
 * - D-10 (META_GAPS byte-frozen): META_GAPS strings are byte-identical to the
 *   canonical reference (spike-findings-engram §3) for MCP-08 fixture reproducibility.
 *
 * Threat model:
 * - **T-04-DOS (Denial of Service):** `trimToBudget` is the mitigation — enforces
 *   ≤ 7,500 cl100k_base tokens before any tool handler returns. Schema-level
 *   `limit ≤ 25` (Plan 01 Task 3) is the first line of defense; post-trim is the
 *   safety net.
 * - **T-03-DD-RT carry-forward (Information Disclosure):** `workspace_id` never
 *   appears in envelope output — invariant carried forward from Phase 3 schemas.
 *
 * @module @engram/mcp-server/envelope
 */
// packages/mcp-server/src/envelope.ts
// Source: 04-CONTEXT.md D-04/D-06/D-07/D-08/D-09/D-10 + spike-findings-engram §3 (META_GAPS byte-frozen).
// Phase 5 will POPULATE these fields with real AI values without changing the envelope shape.

import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import type { EngramResponse } from "@engram/types";
import type { LexicalSearchHit } from "@engram/workspace-do";
import type {
  RememberResult,
  RecallResult,
  RecallChunk,
  SearchResult,
  ForgetResult,
  IngestResult,
} from "./result-types.js";

// ---------------------------------------------------------------------------
// META_GAPS — byte-frozen canonical gap strings (D-10 paragraph 3)
// ---------------------------------------------------------------------------

/**
 * Canonical gap strings surfaced in `EngramResponse.meta.gaps` for each tool.
 *
 * D-10 paragraph 3: these strings MUST be byte-identical to the canonical reference
 * `.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md` §3.
 * Any change to these strings invalidates the Plan 01 snapshot-lock test and the
 * MCP-08 token-budget worst-case fixture byte counts. Do NOT paraphrase.
 *
 * `as const` ensures each array's literal type narrows — consumers can index into
 * `META_GAPS.recall[0]` and get a string literal type, not `string`.
 */
export const META_GAPS = {
  remember: [
    "AI classification lands in Phase 5. classified_type echoes args.type when supplied.",
    "Conflict detection lands in Phase 5 (semantic similarity via Vectorize).",
  ],
  recall: [
    "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only.",
  ],
  search: ["Lexical (LIKE) backing — semantic search lands in Phase 5."],
  forget: [] as string[],
  ingest: ["Async enrichment pipeline lands in Phase 6 — job is recorded but not yet processed."],
  // Phase 5 Plan 05-03: per-call gap surfaced in meta.gaps when content > 1,800 chars is truncated
  // for embedding. The full content is stored in SQLite but only the first ~512 tokens are
  // semantically searchable via Vectorize. Byte-frozen per D-10 — do NOT paraphrase.
  truncationOver1800Chars:
    "Content over 1,800 chars truncated for embedding; full content stored in SQLite but only the first ~512 tokens are semantically searchable.",
} as const;

// ---------------------------------------------------------------------------
// BUDGET — file-local token cap (D-10)
// ---------------------------------------------------------------------------

// D-10: 7,500 token margin under the 8K MCP-08 cap.
// Over-counting margin of ~5% vs Claude's actual BPE via cl100k_base (D-09).
const BUDGET = 7500;

// ---------------------------------------------------------------------------
// countTokens — file-local BPE helper
// ---------------------------------------------------------------------------

/**
 * Counts the BPE token length of the JSON-serialized envelope using cl100k_base.
 *
 * Over-counts vs Claude's actual BPE by ~5% (intentional safety margin per D-09).
 * Used by `trimToBudget` to decide when trimming is needed.
 *
 * NOT exported — file-local helper only.
 */
function countTokens(envelope: unknown): number {
  return encode(JSON.stringify(envelope)).length;
}

// ---------------------------------------------------------------------------
// buildRememberResponse — D-06 honest stub
// ---------------------------------------------------------------------------

/**
 * Builds the `EngramResponse<RememberResult>` envelope for a `remember()` tool call.
 *
 * D-06 honest-stub contract: `extracted_fields` is `{}`, `confidence` is `null`,
 * `meta.confidence` and `meta.coverage` are `null` — no AI classification ran in v0.1.
 * Phase 5 / AI-05 will populate these fields via Triage Worker entity extraction without
 * changing this builder's signature.
 *
 * Pitfall 3: `meta.last_updated` uses `Date.now()` (a `number`), NEVER `new Date()`.
 * `Date` objects JSON-stringify as ISO strings — not `number` — breaking type contracts.
 *
 * D-08: `context.conflicts: []` always in v0.1 — Phase 5 / AI-02 populates via
 * Vectorize semantic similarity scan at write time.
 *
 * D-04: `suggestions` field is OMITTED ENTIRELY (not present-with-undefined).
 */
export function buildRememberResponse(input: {
  id: string;
  classified_type: string | null;
  /** Optional additional gap strings appended AFTER the canonical META_GAPS.remember entries.
   * Phase 5 Plan 05-03: used by the truncation-warn path in the remember() handler when
   * content > 1,800 chars is truncated for embedding. Callers that do NOT truncate pass
   * `undefined` (or omit the field) — backward-compatible with all Phase 4 call sites. */
  extraGaps?: string[];
}): EngramResponse<RememberResult> {
  return {
    result: {
      id: input.id,
      classified_type: input.classified_type,
      extracted_fields: {},
      confidence: null,
    },
    context: {
      related: [],
      entities: [],
      conflicts: [],
    },
    meta: {
      confidence: null,
      coverage: null,
      last_updated: Date.now(),
      gaps: [...META_GAPS.remember, ...(input.extraGaps ?? [])],
    },
  };
}

// ---------------------------------------------------------------------------
// buildRecallResponse — D-02 verbosity branches + D-07 honest stub
// ---------------------------------------------------------------------------

/**
 * Builds the `EngramResponse<RecallResult>` envelope for a `recall()` tool call.
 *
 * D-02 (verbosity enum): `verbosity` controls whether the `chunks` field is present:
 * - `"synthesis"` → `result.chunks` is ABSENT (key not present — not undefined).
 * - `"chunks"` or `"both"` → `result.chunks` is an array of `RecallChunk` objects.
 *
 * D-07 (synthesis: null): `result.synthesis` is ALWAYS `null` in v0.1 regardless
 * of verbosity. Phase 5 / AI-04 populates with real CF AI synthesis after Vectorize
 * search without changing this builder's signature.
 *
 * Spike §1 (default flip rationale): `verbosity` default is `"both"` — it captures
 * both dimensions. The BORDERLINE band decision (spike-001/002) keeps this field.
 */
export function buildRecallResponse(input: {
  memories: LexicalSearchHit[];
  verbosity: "synthesis" | "chunks" | "both";
}): EngramResponse<RecallResult> {
  const chunksField =
    input.verbosity === "synthesis"
      ? {}
      : {
          chunks: input.memories.map(
            (memory): RecallChunk => ({
              id: memory.id,
              content_excerpt: memory.snippet ?? (memory.content ?? "").slice(0, 300),
              score: null,
            }),
          ),
        };

  const lastUpdated =
    input.memories.length > 0 ? Math.max(...input.memories.map((m) => m.created_at)) : Date.now();

  return {
    result: {
      memories: input.memories,
      synthesis: null,
      ...chunksField,
    },
    context: {
      related: [],
      entities: [],
      conflicts: [],
    },
    meta: {
      confidence: null,
      coverage: null,
      last_updated: lastUpdated,
      gaps: [...META_GAPS.recall],
    },
  };
}

// ---------------------------------------------------------------------------
// buildSearchResponse — TOL-03 (NO `format?` param, returns memories + count)
// ---------------------------------------------------------------------------

/**
 * Builds the `EngramResponse<SearchResult>` envelope for a `search()` tool call.
 *
 * TOL-03 (explicitly rejected per CLAUDE.md `search(query, filters)` spec): the
 * function signature MUST NOT accept a `format?` parameter. The `search` tool
 * returns `memories` and `count` only — there is no format/export capability on
 * search (that ships as a separate `export` tool in v0.3).
 *
 * `count` is derived from `memories.length` — single source of truth, eliminates
 * inconsistency risk between a caller-supplied count and the actual memories array.
 *
 * Accepts an optional `count` input for forward compatibility with callers that
 * compute count separately, but the returned `result.count` always reflects
 * `memories.length` (the authoritative source).
 */
export function buildSearchResponse(input: {
  memories: LexicalSearchHit[];
  count?: number;
}): EngramResponse<SearchResult> {
  const lastUpdated =
    input.memories.length > 0 ? Math.max(...input.memories.map((m) => m.created_at)) : Date.now();

  return {
    result: {
      memories: input.memories,
      count: input.memories.length,
    },
    context: {
      related: [],
      entities: [],
      conflicts: [],
    },
    meta: {
      confidence: null,
      coverage: null,
      last_updated: lastUpdated,
      gaps: [...META_GAPS.search],
    },
  };
}

// ---------------------------------------------------------------------------
// buildForgetResponse — TOL-04 (echo blocks_deleted + relations_deleted truth)
// ---------------------------------------------------------------------------

/**
 * Builds the `EngramResponse<ForgetResult>` envelope for a `forget()` tool call.
 *
 * TOL-04 + Pitfall 4: ECHO the truth from `WorkspaceDO.deleteBlock()`. Do NOT
 * throw when `blocks_deleted: 0` — that is idempotent semantics. If a client
 * calls `forget("nonexistent-id")`, the envelope returns `result.blocks_deleted: 0`
 * and the client knows the call was a no-op. This matches Phase 2's `deleteBlock`
 * return shape and the idempotent delete contract.
 *
 * `meta.gaps` is `[]` (empty) because `forget` is fully implemented in v0.1 —
 * no AI stubs to explain, no Phase 5 gap to flag. D-04 carveout: cascade is real.
 *
 * D-04: `suggestions` field OMITTED ENTIRELY.
 */
export function buildForgetResponse(input: {
  blocks_deleted: number;
  relations_deleted: number;
  id?: string;
}): EngramResponse<ForgetResult> {
  return {
    result: {
      blocks_deleted: input.blocks_deleted,
      relations_deleted: input.relations_deleted,
    },
    context: {
      related: [],
      entities: [],
      conflicts: [],
    },
    meta: {
      confidence: null,
      coverage: null,
      last_updated: Date.now(),
      gaps: [...META_GAPS.forget],
    },
  };
}

// ---------------------------------------------------------------------------
// buildIngestResponse — D-05 (status: "accepted" literal, synthetic UUID job_id)
// ---------------------------------------------------------------------------

/**
 * Builds the `EngramResponse<IngestResult>` envelope for an `ingest()` tool call.
 *
 * D-05 (synthetic accepted contract): the function accepts a `job_id` parameter —
 * the handler in Plan 03 generates the UUID via `crypto.randomUUID()` and passes it
 * in. This builder does NOT call `crypto.randomUUID()` itself — the builder is pure
 * (testable without mocking the UUID generator).
 *
 * Phase 6 swap-in note: Phase 6's diff against `ingest()`'s handler is exactly one
 * line: replace the `void 0` queue stub with
 * `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` — this builder does not change.
 *
 * D-04: `suggestions` field OMITTED ENTIRELY.
 */
export function buildIngestResponse(input: { job_id: string }): EngramResponse<IngestResult> {
  return {
    result: {
      status: "accepted",
      job_id: input.job_id,
    },
    context: {
      related: [],
      entities: [],
      conflicts: [],
    },
    meta: {
      confidence: null,
      coverage: null,
      last_updated: Date.now(),
      gaps: [...META_GAPS.ingest],
    },
  };
}

// ---------------------------------------------------------------------------
// trimToBudget helpers — file-local (D-10)
// ---------------------------------------------------------------------------

/**
 * Type guard: returns true when `envelope.result` has a `memories` array.
 * Used by `trimToBudget` to determine whether the 3-step trim algorithm applies.
 * Generic `T` cannot narrow `result.memories` directly across the 5 builder
 * result types; this guard provides a type-safe narrowing path.
 */
function hasMemoriesArray(
  envelope: EngramResponse<unknown>,
): envelope is EngramResponse<{ memories: LexicalSearchHit[] } & Record<string, unknown>> {
  return (
    "memories" in (envelope.result as Record<string, unknown>) &&
    Array.isArray((envelope.result as { memories?: unknown }).memories)
  );
}

/**
 * Returns a new envelope with the named field set to `null` on every entry
 * in `result.memories`. Uses spread + map — does NOT mutate the input.
 */
function dropMemoryField<T extends { memories: LexicalSearchHit[] }>(
  envelope: EngramResponse<T>,
  field: "content" | "summary",
): EngramResponse<T> {
  return {
    ...envelope,
    result: {
      ...envelope.result,
      memories: envelope.result.memories.map((m) => ({
        ...m,
        [field]: null,
      })),
    },
  };
}

/**
 * Returns a new envelope with the last element of `result.memories` removed.
 * Uses spread + slice — does NOT mutate the input.
 */
function dropLastMemory<T extends { memories: LexicalSearchHit[] }>(
  envelope: EngramResponse<T>,
): EngramResponse<T> {
  return {
    ...envelope,
    result: {
      ...envelope.result,
      memories: envelope.result.memories.slice(0, -1),
    },
  };
}

// ---------------------------------------------------------------------------
// trimToBudget — D-10 post-trim algorithm
// ---------------------------------------------------------------------------

/**
 * Enforces the MCP-08 token budget (≤ 7,500 cl100k_base tokens) on any
 * `EngramResponse<T>` envelope using the D-10 priority order:
 *
 * 1. If already ≤ BUDGET: return the same reference (no copy overhead).
 * 2. Step 1 — drop `result.memories[i].content` → set to `null` on each entry.
 * 3. Step 2 — drop `result.memories[i].summary` → set to `null` on each entry.
 * 4. Step 3 — drop trailing memories one-by-one until under budget or only one remains.
 *
 * D-10 invariants (NEVER violated):
 * - `envelope.meta` is NEVER dropped (load-bearing signals for Claude).
 * - `envelope.context.conflicts` is NEVER dropped (even when empty — load-bearing signal).
 * - `envelope.result.id` on `buildRememberResponse` outputs is NEVER dropped
 *   (remember() envelopes have no `memories` array, so the trim algorithm never
 *   applies to them anyway).
 *
 * Worst-case sanity check (D-10): 25 memories × 4KB content → after Step 1
 * ≈ 2.5K tokens, well under 7,500. Trim should rarely fire in practice given
 * the schema-level `limit ≤ 25` cap from Plan 01 Task 3. The post-trim is
 * a defense-in-depth safety net.
 *
 * Immutability: builds fresh nested objects on each step — input is NOT mutated.
 */
export function trimToBudget<T>(envelope: EngramResponse<T>): EngramResponse<T> {
  // Short-circuit: under budget — return same reference (no copy overhead).
  if (countTokens(envelope) <= BUDGET) {
    return envelope;
  }

  // Only the memories-array path is subject to trimming.
  if (!hasMemoriesArray(envelope)) {
    // Non-memories envelope (e.g., remember/ingest/forget) over budget — return as-is.
    // In practice this should not happen given the small fixed size of these envelopes.
    return envelope;
  }

  // After the hasMemoriesArray guard we know result.memories exists.
  // Use a typed alias to avoid repeated unsafe casts in the algorithm.
  type WithMemories = { memories: LexicalSearchHit[] } & Record<string, unknown>;

  // Step 1: drop content field from each memory.
  let trimmed = dropMemoryField(
    envelope as unknown as EngramResponse<WithMemories>,
    "content",
  ) as unknown as EngramResponse<T>;
  if (countTokens(trimmed) <= BUDGET) {
    return trimmed;
  }

  // Step 2: also drop summary field from each memory.
  trimmed = dropMemoryField(
    trimmed as unknown as EngramResponse<WithMemories>,
    "summary",
  ) as unknown as EngramResponse<T>;
  if (countTokens(trimmed) <= BUDGET) {
    return trimmed;
  }

  // Step 3: drop trailing memories one-by-one until under budget or only 1 remains.
  let current = trimmed as unknown as EngramResponse<WithMemories>;
  while (countTokens(current) > BUDGET && current.result.memories.length > 1) {
    current = dropLastMemory(current);
  }

  return current as unknown as EngramResponse<T>;
}

// ---------------------------------------------------------------------------
// wrapMcpContent — MCP transport-layer wrapper (Pitfall 7)
// ---------------------------------------------------------------------------

/**
 * Wraps an `EngramResponse<T>` envelope in the MCP SDK content-array format.
 *
 * Pitfall 7: the MCP SDK expects handlers to return
 * `{ content: [{ type: "text", text: string }] }`. Returning a raw `EngramResponse`
 * breaks the MCP Inspector and all compliant MCP clients. This wrapper is the
 * canonical last step on every tool handler's happy path:
 *   `return wrapMcpContent(trimToBudget(envelope))`
 *
 * The return type is a single-element tuple `[{ type: "text"; text: string }]`
 * — NOT a variable-length array — to match the MCP SDK's `CallToolResult.content`
 * array shape and provide strongly-typed return paths in Plan 03 handler bodies.
 *
 * Pitfall 3 compliance: `JSON.stringify(envelope)` is safe here because every
 * builder returns only primitives, arrays, and plain objects — no `Date`, `Map`,
 * or `BigInt` values that would stringify lossily.
 */
export function wrapMcpContent<T>(envelope: EngramResponse<T>): {
  content: [{ type: "text"; text: string }];
} {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
  };
}
