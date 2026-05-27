/**
 * `result-types` — typed result aliases for the 5 `EngramResponse<T>` builders.
 *
 * Cross-phase contract:
 * - **Phase 2 STO-07 / `deleteBlock` return shape:** `ForgetResult` mirrors
 *   `WorkspaceDO.deleteBlock()` output verbatim so tool handlers can echo the
 *   truth (echo 0, don't throw on bogus id — Pitfall 4).
 * - **Phase 3 D-04 (tool registration):** These types are the `T` in
 *   `EngramResponse<T>` that the 5 handler bodies return via the envelope builders.
 *   Phase 3 ships registration stubs; Phase 4 fills the bodies against these types.
 * - **Phase 4 (TOL-01..05 / D-05 / D-06 / D-07):** This file defines the locked
 *   result shapes that Plan 02's `envelope.ts` builders will construct and Plan
 *   03's handler bodies will populate. No production code imports this file until
 *   Plan 02 ships.
 * - **Phase 5 population:** Fields typed `null` or `optional` in v0.1 will be
 *   populated by Phase 5 AI integration WITHOUT changing the interface shape.
 *   Phase 5's diff is a handler-body change, not a contract change.
 *
 * Design notes (locked):
 * - All exports are `interface` (not `type`) per `@typescript-eslint/consistent-type-definitions`.
 * - Named exports only — no default export (tree-shake-friendly + explicit import sites).
 * - `LexicalSearchHit` is imported type-only per `verbatimModuleSyntax`.
 * - `RecallChunk.score` is `null` in v0.1 (lexical, unranked); Phase 5 populates with Vectorize cosine.
 * - `RecallResult.synthesis` is `null` in v0.1 (D-07 honest stub); Phase 5 populates with CF AI synthesis.
 * - `IngestResult.status` is the string literal `"accepted"` (not `string`) — locks D-05 contract.
 * - `ForgetResult` mirrors `deleteBlock` return shape; `blocks_deleted: 0` is valid (don't throw on miss).
 *
 * Threat model:
 * - **T-04-WIDEN (Information Disclosure):** `number | null` fields are the
 *   widened type from the `shared/types` widen (Task 2). Phase 3 ships no consumer
 *   of `EngramResponse.meta.*` so the widening is forward-compatible.
 * - **T-04-RED-MIRROR (Information Disclosure):** Test failures that import from
 *   this file produce "is not a function" / "missing export" messages — no
 *   production secrets, DB internals, or env values are surfaced.
 *
 * @module @engram/mcp-server/result-types
 */
// packages/mcp-server/src/result-types.ts
// Source: 04-CONTEXT.md D-05/D-06/D-07 + spike-findings-engram §"recall.chunks" shape.

import type { LexicalSearchHit } from "@engram/workspace-do";

// ---------------------------------------------------------------------------
// RememberResult — T in EngramResponse<RememberResult>
// ---------------------------------------------------------------------------

/**
 * The `result` field of a `remember()` tool response (D-06 honest-stub contract).
 *
 * - `id` is the real UUID written to `WorkspaceDO.insertBlock()`.
 * - `classified_type` echoes `args.type` when supplied; `null` otherwise (no AI inference in v0.1).
 * - `extracted_fields` is `{}` in v0.1; Phase 5 / AI-05 populates via Triage Worker entity extraction.
 * - `confidence` is `null` in v0.1 (no AI classification ran); Phase 5 populates with CF AI scores.
 */
export interface RememberResult {
  /** Real UUID written by `WorkspaceDO.insertBlock()`. Never null. */
  id: string;
  /**
   * Memory type id echoed from `args.type`, or `null` when not supplied.
   * Phase 5 / AI-05 will infer and override this with CF AI classification.
   */
  classified_type: string | null;
  /**
   * Typed fields extracted from content by CF AI (empty `{}` in v0.1).
   * Phase 5 / AI-05 populates via Triage Worker entity extraction.
   */
  extracted_fields: Record<string, unknown>;
  /**
   * CF AI classification confidence (0–1), or `null` when no AI ran (v0.1 honest-stub — D-06).
   * Phase 5 populates with real Vectorize-derived numbers.
   */
  confidence: number | null;
}

// ---------------------------------------------------------------------------
// RecallChunk — pre-synthesis excerpt returned when verbosity includes "chunks"
// ---------------------------------------------------------------------------

/**
 * One pre-synthesis chunk returned by `recall()` when `verbosity` is `"chunks"` or `"both"` (D-07).
 *
 * In v0.1, a chunk is derived directly from a `LexicalSearchHit` row — no semantic ranking occurs.
 * Phase 5 / AI-04 replaces the lexical hit with a Vectorize-scored excerpt and populates `score`.
 *
 * Shape locked by spike-findings-engram §"recall.chunks shape".
 */
export interface RecallChunk {
  /** Block id this chunk excerpt comes from. */
  id: string;
  /**
   * First ~300 characters of `content` (or the matched content window) from the block.
   * In v0.1 this is a simple prefix slice; Phase 5 may provide a highlighted match window.
   */
  content_excerpt: string;
  /**
   * Vectorize cosine similarity score (0–1), or `null` in v0.1 (lexical search is unranked — D-07).
   * Phase 5 populates with real Vectorize cosine scores once semantic search is wired.
   */
  score: number | null;
}

// ---------------------------------------------------------------------------
// RecallResult — T in EngramResponse<RecallResult>
// ---------------------------------------------------------------------------

/**
 * The `result` field of a `recall()` tool response (D-07 honest-stub contract).
 *
 * - `memories` contains the full `LexicalSearchHit[]` from `WorkspaceDO.lexicalSearchBlocks()`.
 * - `synthesis` is `null` in v0.1 (no AI synthesis ran); Phase 5 / AI-04 populates.
 * - `chunks` is present when `verbosity` is `"chunks"` or `"both"`; absent when `"synthesis"` only.
 *   In v0.1 each chunk is a truncated excerpt from the corresponding `LexicalSearchHit`.
 */
export interface RecallResult {
  /** Lexical search hits from `WorkspaceDO.lexicalSearchBlocks()`. */
  memories: LexicalSearchHit[];
  /**
   * CF AI synthesis of the memory set, or `null` when no AI synthesis has run (v0.1 honest-stub — D-07).
   * Phase 5 / AI-04 populates with real CF AI synthesis after Vectorize search.
   */
  synthesis: string | null;
  /**
   * Pre-synthesis chunk excerpts, present when `verbosity` is `"chunks"` or `"both"` (D-02/D-07).
   * `undefined` (absent) when `verbosity` is `"synthesis"` only.
   * In v0.1 each chunk is derived from a lexical hit with `score: null`; Phase 5 adds Vectorize scores.
   */
  chunks?: RecallChunk[];
}

// ---------------------------------------------------------------------------
// SearchResult — T in EngramResponse<SearchResult>
// ---------------------------------------------------------------------------

/**
 * The `result` field of a `search()` tool response.
 *
 * `search()` uses the same lexical backing as `recall()` but accepts structured
 * `filters` instead of a free-text synthesis and returns a `count` for pagination.
 * There is no `verbosity` param on `search` — it is recall-only (D-02).
 */
export interface SearchResult {
  /** Lexical search hits from `WorkspaceDO.lexicalSearchBlocks()` with structured filters applied. */
  memories: LexicalSearchHit[];
  /** Total number of matching memories (for pagination). May equal `memories.length` in v0.1. */
  count: number;
}

// ---------------------------------------------------------------------------
// ForgetResult — T in EngramResponse<ForgetResult>
// ---------------------------------------------------------------------------

/**
 * The `result` field of a `forget()` tool response.
 *
 * Mirrors the `WorkspaceDO.deleteBlock()` return shape verbatim (Pitfall 4 — echo truth,
 * do NOT throw when `blocks_deleted: 0`; the caller may have already deleted it or the
 * id is genuinely absent; either is a valid idempotent outcome).
 *
 * Phase 5 / AI-08 will add `vectors_deleted: number` when Vectorize vector cleanup ships.
 */
export interface ForgetResult {
  /** Number of block rows deleted from the `blocks` table. 0 is a valid outcome. */
  blocks_deleted: number;
  /** Number of relation rows deleted from the `relations` table (cascade=true only). */
  relations_deleted: number;
}

// ---------------------------------------------------------------------------
// IngestResult — T in EngramResponse<IngestResult>
// ---------------------------------------------------------------------------

/**
 * The `result` field of an `ingest()` tool response (D-05 synthetic-accepted contract).
 *
 * In v0.1, `ingest()` returns immediately with `status: "accepted"` and a synthetic
 * `job_id`. No Queue side effect is triggered yet (Phase 6 / PIP-01 wires the Queue).
 * Phase 6's diff against the handler is exactly one line:
 *   `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` — same return shape.
 *
 * `status` is the string LITERAL `"accepted"` (not `string`) so the type is
 * discriminable if a future `status: "queued" | "failed"` union is added.
 */
export interface IngestResult {
  /** Always `"accepted"` in v0.1 — the job was received and a job_id assigned. */
  status: "accepted";
  /** Synthetic UUID assigned at ingest time. Phase 6 will use this to correlate async Queue results. */
  job_id: string;
}
