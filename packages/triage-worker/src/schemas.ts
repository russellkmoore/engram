/**
 * Zod input/output schemas for the Triage Worker.
 *
 * Single source of truth — Triage handler bodies `import type { TriageOutput }`
 * for compile-time + `TriageOutput.safeParse(...)` for runtime gate at the
 * LLM boundary.
 *
 * Cross-phase contract:
 * - **Phase 5 AI-05:** the LLM is told (via response_format.json_schema) to emit
 *   this exact shape. The Zod schema is the runtime gate after.
 * - **Phase 5 AI-06:** `memorability` field feeds `routeByMemorability()` in
 *   `memorability.ts` — thresholds (0.8 and 0.4) are LOCKED per AI-SPEC.md and
 *   CONTEXT.md D-07. The schema cap (min/max 0-1) enforces the range invariant.
 * - **Phase 6 PIP-01:** `TRIAGE_JSON_SCHEMA` is passed verbatim to
 *   `env.AI.run(CLASSIFIER_MODEL, { response_format: { type: "json_schema", json_schema: TRIAGE_JSON_SCHEMA } })`
 *   in `extract.ts`. Do NOT change the schema shape without re-evaluating the
 *   Phase 5 promptfoo baseline (eval invalidation) and the memorability bands.
 *
 * Design notes (locked):
 * - Hand-written zod (matches mcp-server/src/schemas.ts) — no zod-to-ts build.
 * - `zodToJsonSchema` derives the `response_format.json_schema` for the LLM —
 *   single source of truth for both the model contract AND the runtime gate.
 * - `z.record(z.string(), z.unknown())` for `extracted_fields` — the shape varies
 *   by `classified_type`; downstream validates per type. Prevents overly-strict
 *   parsing failures when the LLM correctly extracts a non-standard field.
 * - `entities: z.array(Entity).max(50)` — hard cap prevents runaway hallucination
 *   lists (AI-SPEC.md §3 Pitfall — model occasionally produces unbounded arrays).
 *
 * @module @engram/triage-worker/schemas
 */
import { z } from "zod";
import { sanitizeJsonSchemaForWorkersAI } from "@engram/ai-config";

// ---------------------------------------------------------------------------
// SYSTEM_MEMORY_TYPES — system-seeded memory type IDs (schema-as-data)
// ---------------------------------------------------------------------------

/**
 * Canonical system memory type IDs (as const tuple for z.enum + type imports).
 * These match the 7 types seeded in `workspace-do/src/schema.ts` at workspace
 * creation. Must stay in sync with CLAUDE.md `## Memory Types`.
 */
export const SYSTEM_MEMORY_TYPES = [
  "job_application",
  "contact",
  "company",
  "project",
  "research_note",
  "decision_log",
  "meeting_note",
] as const;

// ---------------------------------------------------------------------------
// Entity — extracted entity shape
// ---------------------------------------------------------------------------

/**
 * A single entity extracted from memory content. The LLM populates these
 * in the `entities` array of `TriageOutput`.
 *
 * Type values map to:
 * - `person`  — named individual (e.g., "Alice Smith", "hiring manager Bob")
 * - `company` — organization name (e.g., "Cloudflare", "Acme Corp")
 * - `role`    — job title / role designation (e.g., "SWE", "Staff Engineer")
 * - `date`    — any date expression (ISO, relative "yesterday", partial "Q3 2026")
 * - `url`     — URL, email address, or other web/network identifier
 */
export const Entity = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["person", "company", "role", "date", "url"]),
});

// ---------------------------------------------------------------------------
// TriageOutput — the LLM's structured response
// ---------------------------------------------------------------------------

/**
 * TriageOutput — the Zod schema that the LLM MUST produce via structured JSON
 * output (`response_format.json_schema = TRIAGE_JSON_SCHEMA`).
 *
 * This is BOTH the `response_format` contract (TRIAGE_JSON_SCHEMA is derived
 * from this via `zodToJsonSchema`) AND the runtime gate in `extract.ts`
 * (`TriageOutput.safeParse(candidate)`). Changing a field here changes both.
 *
 * Field contract (from AI-SPEC.md §4b + 05-RESEARCH.md §Example 6):
 * - `classified_type`  — discriminates the 7 system memory types
 * - `extracted_fields` — shape varies by `classified_type`; downstream validates
 * - `entities`         — hard cap at 50 (Pitfall — unbounded hallucination lists)
 * - `summary`          — 10-char floor (must say something); 800-char cap (LLM budget)
 * - `memorability`     — 0-1 score; bands routed by memorability.ts
 * - `confidence`       — 0-1 score; feeds meta.confidence in EngramResponse
 */
export const TriageOutput = z.object({
  classified_type: z.enum(SYSTEM_MEMORY_TYPES),
  extracted_fields: z.record(z.string(), z.unknown()),
  entities: z.array(Entity).max(50),
  summary: z.string().min(10).max(800),
  memorability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

/** TypeScript type alias — same name as the Zod schema (z.infer pattern). */
export type TriageOutput = z.infer<typeof TriageOutput>;

// ---------------------------------------------------------------------------
// TRIAGE_JSON_SCHEMA — derived from TriageOutput for LLM response_format
// ---------------------------------------------------------------------------

/**
 * JSON schema derived from TriageOutput via Zod v4's native `z.toJSONSchema`.
 * Passed verbatim to:
 *   `env.AI.run(CLASSIFIER_MODEL, { response_format: { type: "json_schema", json_schema: TRIAGE_JSON_SCHEMA } })`
 *
 * ENG-21 fix: previously this used `zodToJsonSchema` from the third-party
 * `zod-to-json-schema@3.x` package, which is INCOMPATIBLE with zod@4 and
 * silently returned `{}` (verified locally via repro script on 2026-05-31).
 * That meant production was sending an EMPTY json_schema to Workers AI for
 * the entire Phase 5/6/7 lifetime — the model wasn't constrained at all,
 * only the SYSTEM_PROMPT was coaxing JSON-shaped output. The Zod gate at
 * the runtime boundary in extract.ts was catching malformed outputs but
 * we were paying for retries that should have been prevented by the
 * structured-output constraint.
 *
 * Zod v4's built-in `z.toJSONSchema()` is the canonical converter, no
 * third-party dep needed. It produces draft-2020-12 JSON Schema by default,
 * which Workers AI's `response_format.json_schema` accepts.
 *
 * The `$schema` top-level field is harmless to Workers AI but adds bytes
 * to every request — strip it via destructure to keep the constraint tight.
 */
export const TRIAGE_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(TriageOutput);
  void $schema;
  // ENG-25: strip JSON Schema keywords (e.g. `propertyNames`) that Workers AI's
  // JSON Mode validator rejects with error 3030 on llama-4-scout. The shared
  // helper is the single source of truth for which keywords need stripping.
  return sanitizeJsonSchemaForWorkersAI(schema);
})();
