/**
 * `registerTools` — register the 5 v0.1 MCP tools as stubs on an `McpServer`.
 *
 * Cross-phase contract:
 * - **Phase 3 (this plan, 03-03):** ships the registration + stub callback for
 *   each of the 5 v0.1 tools (`remember`, `recall`, `search`, `forget`,
 *   `ingest`). Every callback body is exactly one line — throw
 *   `McpError(ErrorCode.MethodNotFound)` with a message pinned to "Phase 3" +
 *   "Phase 4 (TOL-0N)" per D-05. The SDK auto-validates the input via
 *   `inputSchema` BEFORE invoking the callback (verified against
 *   `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:150-157`),
 *   so the stubs can ignore `args` entirely.
 * - **Phase 3 Plan 05 (downstream consumer):** `EngramMcp.init()` will call
 *   `registerTools(this.server, () => this.props, this.env)` after the OAuth
 *   provider's `completeAuthorization` populates `this.props`. The
 *   `getProps` parameter is a closure so each invocation re-reads the
 *   freshest `this.props` (per RESEARCH Open Question 4 — props may rebind
 *   across token refresh).
 * - **Phase 4 (TOL-01..05):** each callback body is swapped for the
 *   Phase-4-ready handler shape documented in the comment block below. The
 *   registration shape and identity (name + description + inputSchema) stay
 *   STABLE — Phase 4 plans literally diff against this file's callbacks.
 *
 * Design notes (locked):
 * - Schemas are imported from `./schemas.js`; this file declares ZERO inline
 *   schemas (D-06 — schemas.ts is the single source of truth). The
 *   `inputSchema` field of each `registerTool` config receives `<Schema>.shape`
 *   (ZodRawShape), NOT the `z.object` wrapper — that is what the SDK expects.
 * - `EngramProps` is imported `type`-only from `./index.js` (Wave 0
 *   contract). This avoids a Plan-05 circular dependency on `./tools.js`.
 * - `_env` is parameter-prefixed because Phase 3 stubs do not touch the Worker
 *   environment; Phase 4 handlers will dereference `env.WORKSPACE` to call
 *   `getAgentByName`. The eslint config's `argsIgnorePattern` (or its
 *   absence) drove the renaming convention.
 * - Tool descriptions are sourced from CLAUDE.md §"MCP Tool Surface" so the
 *   MCP Inspector smoke (MCP-09) lists the canonical descriptions.
 *
 * Threat model:
 * - **T-03-DD-RT (Tampering / Elevation of Privilege):** mitigated
 *   structurally. (1) Stubs throw before consuming `args`, so even if a
 *   future contributor smuggled a `workspace_id` field through the schema,
 *   no Phase 3 callback would read it. (2) The Phase-4-ready comment block
 *   below documents the canonical handler shape — `await
 *   getAgentByName(env.WORKSPACE, props.workspace_id)` + `args.workspace_id:
 *   props.workspace_id` — and explicitly forbids reading `workspace_id`
 *   from `args` (tool input). (3) `src/__tests__/tools.test.ts` asserts the
 *   non-comment body of this file does NOT contain the literal string
 *   `args.workspace_id` — any regression that wires tool input as the
 *   workspace source fails CI. (4) A unique DD-RT sentinel comment
 *   (declared verbatim inside the Phase-4-ready comment block below) is
 *   the integrity anchor that proves the structural test actually read
 *   the live source — checker WARNING 2.
 * - **T-03-MSG (Information Disclosure):** mitigated. `MethodNotFound`
 *   message strings mention ONLY "Phase 3" and "Phase 4 (TOL-0N)". No DB
 *   internals, no env values, no stack traces.
 * - **T-03-DOS (Denial of Service):** accepted. Stubs throw immediately and
 *   consume no resources; rate-limiting + budget checks are MCP-08
 *   (Phase 4).
 *
 * Plan boundaries:
 * - This module is owned by Plan 03-03 (Wave 2). Plan 03-05 wires the call
 *   site (`EngramMcp.init()`). Phase 4 (TOL-01..05) ships the real bodies.
 *
 * @module @engram/mcp-server/tools
 */
// packages/mcp-server/src/tools.ts
// Source: 03-RESEARCH.md §Pattern 4 (registerTool API verified against
//         node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:150).
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mapToMcpError } from "./error-mapping.js";
import {
  buildRememberResponse,
  buildRecallResponse,
  buildSearchResponse,
  buildForgetResponse,
  buildIngestResponse,
  trimToBudget,
  wrapMcpContent,
  META_GAPS,
} from "./envelope.js";
import {
  safeRun,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  EMBEDDING_DIMS,
  CLASSIFIER_MODEL,
} from "./ai-helper.js";
import {
  MIN_COSINE_THRESHOLD,
  VECTORIZE_OVERFETCH_FACTOR,
  RERANKER_MODEL,
  RERANKER_ENABLED,
} from "@engram/ai-config";
import { vectorizeQuery } from "@engram/vectorize-utils";
import { expandQuery, keepVariantsAboveGate } from "./query-expansion.js";
import { reciprocalRankFusion } from "./rrf.js";
import { vectorizeUpsert, vectorizeDelete } from "./vectorize-helper.js";
import { writeAnalytics, workspaceTag } from "./analytics.js";
import { hybridRank } from "./hybrid-rank.js";
import type { Memory, MemoryEvent, Conflict, InboxConflictProperties } from "@engram/types";
import type { WorkspaceDO, LexicalSearchHit, InboxConflictRow } from "@engram/workspace-do";

import {
  RememberInputSchema,
  RecallInputSchema,
  SearchInputSchema,
  ForgetInputSchema,
  IngestInputSchema,
} from "./schemas.js";
import type { EngramProps } from "./index.js";

// ---------------------------------------------------------------------------
// Phase 5 D-01 / D-02 / D-03: recall() synthesis helpers
// Post-processor helpers are exported so unit tests (synthesis-postprocess.test.ts,
// synthesis-preflight.test.ts) can import them directly (Plan 04-03).
// ---------------------------------------------------------------------------

/**
 * System prompt for the opt-in synthesis call (verbosity ∈ {"synthesis", "both"}).
 * Per spike-findings-engram §6: preserve the 5 drop categories — dates, sources,
 * technical identifiers, numeric values, decision-rejection naming.
 */
// ENG-22: `as const` can only apply to literals (enum members, string/number/
// boolean/array/object literals) — not to a parenthesized concatenation expression.
// Collapsed the string-concat into a single template literal so the assertion is
// valid AND the prompt stays byte-stable for the spike-findings-engram §6 contract.
const SYNTHESIS_SYSTEM_PROMPT =
  `You are Engram's recall synthesizer. Given a user query and the top-ranked memories that matched it, produce a 2-4 sentence summary that:
- Directly answers the user's query when possible
- Preserves dates, sources, technical identifiers, numeric values, and decision-rejection naming (5 drop categories per spike-findings-engram §6)
- Cites memories by their position ("memory 1 / memory 2 / ...") when referring to specifics
- Acknowledges gaps when the memories don't directly answer the query (do NOT fabricate)
Output prose only; no markdown headers; no JSON; no bullet lists.` as const;

/**
 * Trims the ranked memories list to fit within maxTokens worth of synthesis input.
 * Per AI-SPEC.md §4b "Context Window Strategy": drop trailing memories first.
 * Conservative estimate: ~4 chars per token.
 *
 * SYN-05: Throws when ALL memories exceed the token budget (empty result after trimming).
 * The throw propagates into the existing try/catch in the synthesis block, which sets
 * synthesis=null and surfaces the failure via meta.gaps (honest-stubs posture).
 */
export function trimRankedForSynthesis(
  memories: LexicalSearchHit[],
  maxTokens: number,
): LexicalSearchHit[] {
  const charBudget = maxTokens * 4;
  let used = 0;
  const out: LexicalSearchHit[] = [];
  for (const m of memories) {
    const cost = (m.summary?.length ?? 0) + (m.content?.length ?? 0);
    if (used + cost > charBudget) break;
    out.push(m);
    used += cost;
  }
  // SYN-05: if no memory fits within budget, throw — the synthesis try/catch catches this
  // and surfaces via meta.gaps ("synthesis skipped: context exceeded 6K token budget").
  if (out.length === 0) {
    throw new Error("synthesis-preflight: all memories exceed 6K token budget");
  }
  return out;
}

/**
 * Formats ranked memories into a synthesis prompt body.
 */
function formatBlocksForSynthesis(memories: LexicalSearchHit[], query: string): string {
  const lines = [`Query: ${query}`, "", "Top memories:"];
  memories.forEach((m, i) => {
    lines.push(
      `${String(i + 1)}. [${m.type ?? "unknown"}] ${m.summary ?? m.content?.slice(0, 300) ?? "(empty)"}`,
    );
  });
  return lines.join("\n");
}

/**
 * SYN-06: Prepends a hedge prefix to the synthesis string when the minimum cosine
 * score over the source memories is below 0.7.
 * Applied AFTER safeRun returns, BEFORE mapPositionsToCitationIds.
 */
export function applyHedgePrefix(synthesis: string, lowConfidence: boolean): string {
  if (lowConfidence) {
    return (
      "Note: the following is based on loosely-matched memories and may be incomplete. " + synthesis
    );
  }
  return synthesis;
}

/**
 * D-02: Replaces "memory N" (case-insensitive, word-boundary-aware) with [block_id]
 * from the ranked list ordering (trimmedForSynth[i] ↔ "memory i+1").
 * Out-of-range citations (N > trimmedForSynth.length) remain as literal text —
 * dropUncitedSentences then drops sentences containing them (D-03 is subsumed by D-09).
 */
export function mapPositionsToCitationIds(
  synthesis: string,
  trimmedForSynth: LexicalSearchHit[],
): string {
  let result = synthesis;
  for (let i = 0; i < trimmedForSynth.length; i++) {
    const position = i + 1;
    const mem = trimmedForSynth[i];
    if (mem === undefined) continue;
    const blockId = mem.id;
    // Use word-boundary lookahead so "memory 10" is not partially matched by "memory 1".
    result = result.replace(
      new RegExp(`memory ${String(position)}(?=\\b|[^0-9])`, "gi"),
      `[${blockId}]`,
    );
  }
  return result;
}

/**
 * D-09: Drops every sentence in the synthesis that does not contain a citation marker
 * ([block_id]), EXCEPT:
 *   (a) the first sentence when lowConfidenceHedge=true (the hedge prefix sentence), and
 *   (b) gap-acknowledgment sentences containing words like "no information" / "not found".
 *
 * Uses Intl.Segmenter as primary; falls back to regex sentence splitting if absent.
 */
export function dropUncitedSentences(
  synthesis: string,
  trimmedForSynth: LexicalSearchHit[],
  opts: { lowConfidenceHedge?: boolean } = {},
): string {
  // Suppress unused param: trimmedForSynth is part of the public contract for
  // potential future use (e.g., citation-density checks per SYN-03).
  void trimmedForSynth;

  const CITATION_RE = /\[[^\]]+\]/;
  const GAP_ACK_RE = /\b(no information|not found|unable to|unclear|gap|don't have)\b/i;

  // Pre-split on ". [" boundaries that Intl.Segmenter won't detect (citation markers
  // begin with "[", not a capital letter, so they don't trigger ICU sentence rules).
  // Insert a sentinel newline before each ". [" boundary so the segmenter sees a break.
  const PRESPLIT_RE = /([.!?])\s+(?=\[)/g;
  const presplit = synthesis.replace(PRESPLIT_RE, "$1\n");

  let segments: { segment: string; index?: number }[];
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    segments = [...segmenter.segment(presplit)];
  } catch {
    // Regex fallback for workerd environments where Intl.Segmenter is absent.

    const parts = presplit.split(/(?<=[.!?])\s+(?=[A-Z[])/);
    segments = parts.map((s) => ({ segment: s }));
  }

  const kept: string[] = [];
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (seg === undefined) continue;
    const sentence = seg.segment.trim();
    if (!sentence) continue;
    const isFirstAndHedge = opts.lowConfidenceHedge === true && idx === 0;
    const isGapAck = GAP_ACK_RE.test(sentence);
    if (isFirstAndHedge || isGapAck || CITATION_RE.test(sentence)) {
      kept.push(seg.segment);
    }
  }
  return kept.join("").trim();
}

/**
 * Analytics Engine environment tag (AI-SPEC.md §7 indexes[0]).
 * TODO: derive from env.ENVIRONMENT if Phase 7 adds staging/dev split.
 */
const ANALYTICS_ENV_TAG = "engram-prod" as const;

/**
 * Tool description for `recall()` — D-02 discoverability triad surface #1.
 * Amended in Phase 5 to document the default verbosity and the opt-in synthesis path.
 * MUST stay ≤ 1,500 UTF-8 bytes (MCP-08 per token-budget.test.ts).
 */
const RECALL_TOOL_DESCRIPTION =
  `Semantic recall over the user's memories. Queries Cloudflare Vectorize with the embedded query ` +
  `and returns the top-K most relevant memories, re-ranked by a hybrid score (cosine + recency ` +
  `+ type-match + scope-match). Use this for "what do I know about X" style queries where exact ` +
  `wording isn't guaranteed.\n\n` +
  `Default verbosity is 'chunks' (raw memories + scored chunks, no LLM summary). Pass verbosity: ` +
  `'synthesis' to add an LLM summary (adds 2–5s latency). Pass verbosity: 'both' to get both.\n\n` +
  `Args: query (required), types?, project?, scope?, limit? (max 25), since?, until?, verbosity?`;

/**
 * Register the 5 v0.1 MCP tools on the given `McpServer`. Every callback is
 * a Phase 3 stub that throws `McpError(MethodNotFound)` — Phase 4 swaps the
 * callback body while preserving the registration.
 *
 * @param server   the `McpServer` instance owned by `EngramMcp` (Plan 03-05
 *                 wires this from `this.server`).
 * @param getProps a closure returning the live `EngramProps` (`undefined`
 *                 before OAuth `completeAuthorization` has run). Phase 3
 *                 stubs do not call this — Phase 4 handlers will.
 * @param env      the Worker `Env`. Phase 3 stubs do not dereference it —
 *                 Phase 4 handlers will read `env.WORKSPACE` for the
 *                 `getAgentByName` lookup.
 * @param getCtx   lazy closure returning the live `DurableObjectState` of the
 *                 owning `EngramMcp` session DO. Used by Phase 6 Plan 06-04's
 *                 `remember()` handler to invoke `getCtx().waitUntil(...)` for
 *                 fire-and-forget Queue enqueue. Lazy pattern matches
 *                 `getProps` — survives any future agents/mcp rebinding of
 *                 `this.ctx` across token refresh (Pitfall 6).
 */
export function registerTools(
  server: McpServer,
  getProps: () => EngramProps | undefined,
  env: Env,
  getCtx: () => DurableObjectState,
): void {
  // --------------------------------------------------------------------------
  // Phase-4-ready handler shape — DOCUMENTATION ONLY (Phase 3 stubs throw
  // before reaching any of this). Phase 4 plans (TOL-01..05) literally diff
  // each callback body against the canonical shape below.
  //
  // Source: VERIFIED against `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts`
  //         `getAgentByName(namespace, name)` returns `Promise<DurableObjectStub<T>>`
  //         — MUST be awaited (per RESEARCH.md Pitfall 1).
  //
  // SENTINEL-DD-RT-PHASE-03-TOOLS-TS — do not remove; structural test depends on this
  //
  // Defense-in-depth (T-03-DD-RT / MCP-05 / Phase 2 STO-07):
  //   The workspace_id is ALWAYS sourced from `props.workspace_id` (JWT-
  //   derived), NEVER from args (tool input). Any future handler that
  //   reads `args.workspace_id` breaks the defense-in-depth invariant —
  //   the test `tools.test.ts` asserts the production code does NOT
  //   contain `args.workspace_id` outside comment lines.
  //
  // Tool → TOL → WorkspaceDO method mapping:
  //   remember → TOL-01 → insertBlock({ workspace_id, block })
  //   recall   → TOL-02 → lexicalSearchBlocks({ workspace_id, query, limit? })
  //                       (Phase 5 swaps to semantic search via Vectorize)
  //   search   → TOL-03 → lexicalSearchBlocks({ workspace_id, query, limit? })
  //                       (with structured filters layered on top)
  //   forget   → TOL-04 → deleteBlock({ workspace_id, id, cascade? })
  //   ingest   → TOL-05 → (no direct WorkspaceDO method — Phase 6 wires
  //                        the Queue producer; Phase 3 stub will likely be
  //                        the last to lift its MethodNotFound)
  //
  // Canonical Phase-4-ready handler skeleton (for `remember`; others mirror):
  //
  //   async (args, _extra) => {
  //     const props = getProps();
  //     if (props === undefined) {
  //       throw new McpError(
  //         ErrorCode.InvalidRequest,
  //         "Missing authentication context",
  //       );
  //     }
  //     try {
  //       const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
  //       stub.insertBlock({
  //         workspace_id: props.workspace_id,  // ALWAYS from props, NEVER from args (NEVER from tool input)
  //         block: { /* ...derived from args... */ },
  //       });
  //       return { content: [{ type: "text", text: "..." }] };
  //     } catch (err) {
  //       throw mapToMcpError(err);  // src/error-mapping.ts
  //     }
  //   }
  //
  // The two-key invariant (Plan 03-04 T-03-PROPS):
  //   `props` carries EXACTLY `{ workspace_id, user_id }` — no extraneous
  //   fields. Combined with `assertOwnsWorkspace` inside WorkspaceDO (Phase 2
  //   STO-07), this is the defense-in-depth chain that prevents a forged
  //   workspace_id from reaching SQLite.
  // --------------------------------------------------------------------------

  // Typed reference to the WORKSPACE DO namespace. `worker-configuration.d.ts`
  // is generated by `wrangler types` at deploy time; until it exists, cast once
  // here so every handler gets a typed stub without per-line unsafe suppressions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const workspaceNs = (env as any).WORKSPACE as DurableObjectNamespace<WorkspaceDO>;

  // The five `server.registerTool(...)` calls below use `// prettier-ignore`
  // so the tool name stays on the SAME line as the opening paren — the
  // plan's <verify> automation greps for `server.registerTool(\s*"<name>"`
  // and `\s*` in ugrep/standard grep does NOT cross newlines.

  // remember(content, type?, project?, tags?, source?, expires?)
  // prettier-ignore
  server.registerTool("remember", {
    description:
      "Store a memory in the user's workspace. Returns the stored memory with classified type, extracted fields, and detected conflicts.",
    inputSchema: RememberInputSchema.shape,
  }, async (args) => {
    const props = getProps();
    if (props === undefined) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Missing authentication context",
      );
    }
    try {
      const stub = workspaceNs.get(workspaceNs.idFromName(props.workspace_id));
      const id = crypto.randomUUID();
      const now = Date.now();
      // args.tags + args.expires accepted by schema but not yet persisted (no Memory field)
      const block: Memory = {
        id,
        type: args.type ?? null,
        content: args.content,
        summary: null,
        properties: null,
        embedding_id: null,
        scope: "personal",
        project_id: args.project ?? null,
        source: args.source ?? "mcp:claude",
        confidence: null,
        created_at: now,
        updated_at: now,
      };
      await stub.insertBlock({
        workspace_id: props.workspace_id, // ALWAYS from props, NEVER from args
        block,
      });

      // === Phase 5 AI-03: sync embed + stamp + upsert (lands HERE per PLAN 05-03) ===
      // LATENCY BUDGET: total 430ms p50 for remember() (AI-SPEC.md §4b).
      // WARNING: Do NOT add additional env.AI.run calls here — entity extraction and
      // memorability scoring belong in Triage Worker (Plan 05-04), NOT inline.
      // Adding CLASSIFIER_MODEL here breaks the 430ms p50 budget (RESEARCH Pitfall 5).

      // Step 1: Truncation — per CONTEXT.md Claude's Discretion §"Long-content truncation policy"
      // Full content already stored in SQLite above; only embedding side gets truncated.
      //
      // ENG-22: Memory.content is typed `string | null` (a block can exist
      // without content, e.g. relation-only nodes in v0.3+). For the embed
      // path we must have content — insertBlock above always populates it
      // from args.content (required at remember() entry), so this null check
      // is a defensive narrowing that doubles as a type guard for the rest
      // of this function. If it ever fires it indicates a schema invariant
      // break, not a user error.
      if (block.content === null) {
        throw new Error(
          "remember(): block.content is null after insertBlock — schema invariant violated",
        );
      }
      const TRUNCATE_THRESHOLD = 1800;
      const contentForEmbed =
        block.content.length > TRUNCATE_THRESHOLD
          ? block.content.slice(0, TRUNCATE_THRESHOLD)
          : block.content;
      const truncated = block.content.length > TRUNCATE_THRESHOLD;

      // Step 2: Embed via safeRun — wraps env.AI.run with dual-path 429 detection.
      // AI-SPEC.md §3 Pitfall 3: unwrap embedResp.data[0], NOT pass full response.
      // On 429: safeRun throws RateLimitError; mapToMcpError below surfaces as InternalError.
      // Inline 429 retry is intentionally absent — remember() is interactive (user retries).
      // Plan 05-04's queue consumer is the only call site that catches RateLimitError.
      //
      // workspaceTag is memoized here — computed ONCE for all analytics calls in this handler.
      // The ~1-3ms Web Crypto overhead is one-time per remember() invocation (T-05-07-LAT: OK).
      const wsTag = await workspaceTag(props.workspace_id);
      const embedStart = Date.now();
      let embedResp: Awaited<ReturnType<typeof safeRun>>;
      try {
         
        embedResp = await safeRun(env, EMBEDDING_MODEL, { text: [contentForEmbed] });
      } catch (err) {
        // Instrument on error path too (retry-429 or throw outcome).
        const embedOutcome =
          err != null && typeof err === "object" && "isRateLimit" in err ? "retry-429" : "throw";
         
        writeAnalytics(env, {
          blobs: ["mcp-server", EMBEDDING_MODEL, wsTag, embedOutcome],
          doubles: [Date.now() - embedStart, contentForEmbed.length, 0, embedOutcome === "retry-429" ? 1 : 0],
          indexes: [ANALYTICS_ENV_TAG],
        });
        throw err; // re-throw so mapToMcpError handles it
      }
       
      writeAnalytics(env, {
        blobs: ["mcp-server", EMBEDDING_MODEL, wsTag, "success"],
        doubles: [Date.now() - embedStart, contentForEmbed.length, 0, 0],
        indexes: [ANALYTICS_ENV_TAG],
      });
      const vector = embedResp.data?.[0];
      if (vector?.length !== EMBEDDING_DIMS) {
        throw new Error(
          `embed: unexpected shape (expected number[${String(EMBEDDING_DIMS)}], got ${String(vector?.length ?? "undefined")})`,
        );
      }

      // Step 3: Stamp embedding columns in SQLite (Plan 05-01 stampEmbedding RPC).
       
      await stub.stampEmbedding({
        workspace_id: props.workspace_id, // ALWAYS from props, NEVER from args
        block_id: id,
        embedding_model: EMBEDDING_MODEL,
        embedding_version: EMBEDDING_VERSION,
      });

      // Step 4: Upsert vector to Vectorize under workspace namespace (AI-02 isolation).
      // vectorizeUpsert stamps namespace = workspaceId unconditionally (Plan 05-02).
      const upsertStart = Date.now();
       
      await vectorizeUpsert(env, props.workspace_id, [
        {
          id,
          values: vector,
          metadata: {
            type: block.type ?? "",
            scope: block.scope,
            created_at: block.created_at,
          },
        },
      ]);
       
      writeAnalytics(env, {
        blobs: ["mcp-server", "vectorize-upsert", wsTag, "success"],
        doubles: [Date.now() - upsertStart, EMBEDDING_DIMS, 0, 0],
        indexes: [ANALYTICS_ENV_TAG],
      });
      // === End Phase 5 AI-03 additions ===

      // === Phase 6 PIP-02: enqueue async enrichment ===
      // MemoryEvent assembly per CONTEXT.md Claude's Discretion §"MemoryEvent payload contents".
      // `id: id` (same UUID as the SQLite row above — A11/IP-1 idempotency hook).
      // `workspace_id: props.workspace_id` — ALWAYS from props, NEVER from args (MCP-05 / MT-1).
      // `source: args.source ?? "mcp:claude"` — mirrors block.source above.
      // `content: args.content` — raw user content, NOT the truncated `contentForEmbed`.
      // `timestamp: now` — same Date.now() used in block.created_at.
      // `hint` is a conditional spread because args.type may be undefined
      // (exactOptionalPropertyTypes — strict TS forbids `{ key: undefined }` literals).
      // `context` is always populated — EngramProps.user_id is typed as `string`
      // (non-optional, JWT-derived).
      const memoryEvent: MemoryEvent = {
        id,
        source: args.source ?? "mcp:claude",
        content: args.content,
        workspace_id: props.workspace_id,
        timestamp: now,
        context: { user_id: props.user_id },
        ...(args.type !== undefined && { hint: args.type }),
      };

      // Phase 6 B3 fix: dereference env.INGEST_QUEUE INSIDE the handler body, NOT at
      // registerTools entry. This is a deliberate departure from the workspaceNs
      // closure-capture pattern above — required so test-time env.INGEST_QUEUE patches
      // (PIP-02 latency test in Plan 06-05 Task 2) take effect, and forward-compatible
      // with any future runtime rebinding. The per-invocation property-lookup cost is
      // negligible.
      const ingestQueue = (env as { INGEST_QUEUE?: Queue<MemoryEvent> }).INGEST_QUEUE;
      if (ingestQueue === undefined) {
        // Binding absent — likely a test env that did not patch INGEST_QUEUE (existing
        // TOL-* tests). Log once per invocation and skip the send so the response path
        // stays green. Production envs MUST have the binding declared in wrangler.jsonc.
        console.warn(
          "mcp-server:INGEST_QUEUE binding absent — queue-send skipped (likely test env without 06-02 binding mock)",
        );
      } else {
        // ctx.waitUntil so remember() returns BEFORE the inner queue send resolves.
        // Fire-and-forget by design (D-03 known limitation: queue.send failure leaves
        // block at ingest_status='pending' indefinitely — v0.2 stuck-pending sweep Cron
        // Worker will address).
        const queueSendStart = Date.now();
        getCtx().waitUntil(
          (async () => {
            try {
              await ingestQueue.send(memoryEvent);
              writeAnalytics(env, {
                blobs: ["mcp-server", "queue-send", wsTag, "success"],
                doubles: [Date.now() - queueSendStart, 1, 0, 0],
                indexes: [ANALYTICS_ENV_TAG],
              });
            } catch (queueErr) {
              console.error("mcp-server:queue-send-failed", {
                id,
                reason: queueErr instanceof Error ? queueErr.message : String(queueErr),
              });
              writeAnalytics(env, {
                blobs: ["mcp-server", "queue-send", wsTag, "throw"],
                doubles: [Date.now() - queueSendStart, 1, 0, 1],
                indexes: [ANALYTICS_ENV_TAG],
              });
            }
          })(),
        );
      }
      // === End Phase 6 additions ===

      // Surface truncation in meta.gaps if content was truncated for embedding.
      const extraGaps = truncated ? [META_GAPS.truncationOver1800Chars] : [];
      const envelope = buildRememberResponse({
        id,
        classified_type: args.type ?? null,
        extraGaps,
      });
      return wrapMcpContent(trimToBudget(envelope));
    } catch (err) {
      throw mapToMcpError(err);
    }
  });

  // recall(query, types?, project?, scope?, limit?, since?, until?)
  // prettier-ignore
  server.registerTool("recall", {
    description: RECALL_TOOL_DESCRIPTION,
    inputSchema: RecallInputSchema.shape,
  }, async (args) => {
    const props = getProps();
    if (props === undefined) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Missing authentication context",
      );
    }
    try {
      // EXP-11: end-to-end recall latency clock — captures the FULL handler
      // (embed → adaptive route → fan-out/RRF → hydrate → hybridRank → conflict
      // hydrate → envelope build). Written as a single 'recall' op blob before the
      // return so the production p50/p99 SLA is a one-row Analytics Engine query
      // instead of summing per-op latencies.
      const recallStart = Date.now();
      const stub = workspaceNs.get(workspaceNs.idFromName(props.workspace_id));

      // T-05-05-TRUNC backfill (Plan 05-06 Task 5): recall-side query-length truncation warn.
      // Mirrors the remember()-side truncation contract (Pitfall 6). Embedding model takes ~512
      // tokens of input; chars over 1,800 are silently dropped. Surface in meta.gaps so Claude
      // can prompt the user to refine the query when the recall semantics may have suffered.
      const QUERY_TRUNCATE_THRESHOLD = 1800;
      const queryWasTruncated = args.query.length > QUERY_TRUNCATE_THRESHOLD;
      const queryForEmbed = queryWasTruncated
        ? args.query.slice(0, QUERY_TRUNCATE_THRESHOLD)
        : args.query;

      // === AI-04 Step 1: embed the query with the SAME model as remember (dimension #2 identity) ===
      // workspaceTag memoized here — computed ONCE for all analytics calls in recall handler.
      const wsTag = await workspaceTag(props.workspace_id);
      const recallEmbedStart = Date.now();
      let embedResp: Awaited<ReturnType<typeof safeRun>>;
      try {
         
        embedResp = await safeRun(env, EMBEDDING_MODEL, { text: [queryForEmbed] });
      } catch (err) {
        const recallEmbedOutcome =
          err != null && typeof err === "object" && "isRateLimit" in err ? "retry-429" : "throw";
         
        writeAnalytics(env, {
          blobs: ["mcp-server", EMBEDDING_MODEL, wsTag, recallEmbedOutcome],
          doubles: [Date.now() - recallEmbedStart, queryForEmbed.length, 0, recallEmbedOutcome === "retry-429" ? 1 : 0],
          indexes: [ANALYTICS_ENV_TAG],
        });
        throw err;
      }
       
      writeAnalytics(env, {
        blobs: ["mcp-server", EMBEDDING_MODEL, wsTag, "success"],
        doubles: [Date.now() - recallEmbedStart, queryForEmbed.length, 0, 0],
        indexes: [ANALYTICS_ENV_TAG],
      });
      const queryVector = embedResp.data?.[0];
      if (queryVector?.length !== EMBEDDING_DIMS) {
        throw new Error(
          `embed query: unexpected shape (expected number[${String(EMBEDDING_DIMS)}], got ${String(queryVector?.length ?? "undefined")})`,
        );
      }

      // === AI-04 Step 2: Vectorize query in workspace namespace (AI-02 isolation via helper) ===
      // topK explicit (Pitfall 7); metadata filter on type when args.types supplied (RESEARCH §Phase 5 Ranking Strategy #2)
      const topK = args.limit ?? 25;
      // ENG-25 hybrid-rank tuning: over-fetch by VECTORIZE_OVERFETCH_FACTOR so
      // the MIN_COSINE_THRESHOLD filter below has buffer matches to choose from
      // when the most-relevant ones don't fill the requested topK. Without
      // over-fetch, threshold-drops would shrink the returned set below topK.
      const fetchSize = topK * VECTORIZE_OVERFETCH_FACTOR;
      const vectorizeQueryStart = Date.now();

      // ENG-22: with exactOptionalPropertyTypes, passing `filter: undefined` is
      // rejected — must conditionally include the key via spread when args.types
      // is set, omit entirely when empty/absent.
      // CR-01: capture the type filter ONCE so the EXP-03 fan-out path applies the
      // SAME metadata filter as the single-query pass. Without this, a type-filtered
      // recall() that trips the adaptive gate would leak off-type memories (the
      // type_match boost in hybridRank only re-orders, it does not exclude).
      const typeFilter = args.types?.length ? { filter: { type: { $in: args.types } } } : {};
      const result = await vectorizeQuery(env, props.workspace_id, queryVector, {
        topK: fetchSize,
        ...typeFilter,
        returnMetadata: "all",
      });

      // === EXP-03: Adaptive routing gate — single-query pass first, fan-out only when top1 < 0.65 ===
      // QE-5 latency lever: to fan out LESS often (cut EXP-11 latency), LOWER this to 0.60.
      // Fan-out fires when top1 < threshold, so RAISING it widens the gate and adds latency.
      const ADAPTIVE_TOP1_THRESHOLD = 0.65;
      const top1 = result.matches[0]?.score ?? 0;

      let mergedMatches = result.matches;
      let expansionUnavailable = false;
      let fanOutFired = false; // EXP-11 telemetry: did the multi-query expansion path run?
      if (top1 < ADAPTIVE_TOP1_THRESHOLD) {
        try {
          // [4] expandQuery — [original, p1, p2] (EXP-01). Re-throws on 429/error for EXP-10 catch.
          const variants = await expandQuery(env, queryForEmbed);
          // [5] keepVariantsAboveGate — cosine ≥ 0.85 (EXP-02). Reuses already-computed queryVector.
          const kept = await keepVariantsAboveGate(env, queryVector, variants, 0.85);
          // [6] Fan-out: embed each surviving variant + vectorize in parallel.
          // workspace_id ALWAYS from props — V4 access control (T-03-05 / INT-03).
          const lists = await Promise.all(
            kept.map(async (v) => {
              const variantEmbedResp = await safeRun(env, EMBEDDING_MODEL, { text: [v] });
              const variantVec = (variantEmbedResp as { data?: number[][] }).data?.[0];
              if (!variantVec) return [] as typeof result.matches;
              const variantResult = await vectorizeQuery(env, props.workspace_id, variantVec, {
                topK: fetchSize,
                ...typeFilter, // CR-01: fan-out honors the same type filter as the single-query pass
                returnMetadata: "all",
              });
              return variantResult.matches;
            }),
          );
          // [7] RRF merge — scale-invariant, rank-based merge of per-variant result lists (EXP-04).
          mergedMatches = reciprocalRankFusion(lists).map((x) => x.item);
          fanOutFired = true;
        } catch {
          // EXP-10: persistent 429 or any expansion error → fall back to single-query path.
          expansionUnavailable = true;
          mergedMatches = result.matches;
        }
      }

      // ENG-25 hybrid-rank tuning: drop matches below MIN_COSINE_THRESHOLD,
      // then cap at the user's requested topK. Vectorize returns the BEST
      // fetchSize matches but doesn't filter on absolute relevance — without
      // this gate, a query with no genuinely-good matches still returns
      // fetchSize loosely-related ones, tanking precision. With qwen3-
      // embedding-0.6b's tight clustering, this gate is essential.
      const filteredMatches = mergedMatches
        .filter((m) => m.score >= MIN_COSINE_THRESHOLD)
        .slice(0, topK);

      // Instrument Vectorize query — zero-match outcome is a critical signal (T-05-07-LAT / AI-SPEC §7).
      const vectorizeQueryOutcome = filteredMatches.length === 0 ? "zero-match" : "success";

      writeAnalytics(env, {
        blobs: ["mcp-server", "vectorize-query", wsTag, vectorizeQueryOutcome],
        doubles: [Date.now() - vectorizeQueryStart, topK, result.matches.length, filteredMatches.length],
        indexes: [ANALYTICS_ENV_TAG],
      });

      // === AI-04 Step 3: hydrate full blocks from SQLite (cold_storage excluded by getBlocksByIds) ===
      const ids = filteredMatches.map((m) => m.id);
      // eslint-disable-next-line @typescript-eslint/await-thenable -- DO stub methods return Promise<T> at runtime via Cloudflare RPC layer
      const blocks = await stub.getBlocksByIds({
        workspace_id: props.workspace_id, // ALWAYS from props, NEVER from args
        ids,
      });

      // === EXP-06: bge-reranker invocation (between RRF/hydrate and hybridRank) ===
      // Builds contexts index-aligned with filteredMatches (after MIN_COSINE_THRESHOLD filter).
      // Empty-content candidates are excluded (Pitfall 6 — keeps them at raw cosine).
      //
      // CRITICAL: `id` in the reranker response is the INTEGER INDEX into the request
      // contexts[] array (reordered by score), NOT a memory/block id (T-03-08 / Pitfall 1).
      // The contexts[] array only contains candidates that survived the empty-content filter,
      // so we keep a parallel `rankedCandidates` array index-aligned with `contexts`.
      //
      // The reranker is called through safeRun (NOT raw env.AI.run) to sidestep workerd#5998
      // which omits the required `query` field from the generated Ai_Cf_Baai_Bge_Reranker_Base_Input
      // type. safeRun's body: Record<string,unknown> sidesteps the typed overload entirely.
      //
      // Reranker logit scores → sigmoid(x)=1/(1+e^-x) → [0,1] before hybridRank.
      // HYBRID_WEIGHTS.rerank was tuned against cosine in [0,1] (Pitfall 2).
      function sigmoid(x: number): number {
        return 1 / (1 + Math.exp(-x));
      }

      // rankedCandidates: only the candidates that have non-empty content/summary.
      // contexts[i] corresponds to rankedCandidates[i].
      // blocks is typed as Memory[] but Memory.content / Memory.summary can be null.
      interface BlockWithText { id: string; content?: string | null; summary?: string | null }
      const blockTextMap = new Map<string, string>(
        (blocks as BlockWithText[]).map((b) => [
          b.id,
          b.content ?? b.summary ?? "",
        ]),
      );
      const rankedCandidates = filteredMatches.filter((m) => {
        const text = blockTextMap.get(m.id) ?? "";
        return text.length > 0;
      });
      const contexts = rankedCandidates.map((m) => ({
        text: blockTextMap.get(m.id) ?? "",
      }));

      // EXP-07 (live ablation 2026-06-08): the bge-reranker is decisively worse
      // than raw cosine on the labeled corpus (F1@3 0.26 vs 0.46), so RERANKER_ENABLED
      // ships false — raw cosine fills the rerank slot via the `?? m.score` default
      // below at the tuned HYBRID_WEIGHTS.rerank=0.6 weight. Gating the call off also
      // removes one Workers AI round-trip per recall (EXP-11 latency).
      const rerankScores = new Map<string, number>();
      if (RERANKER_ENABLED && contexts.length > 0) {
        try {
          const rerankResp = await safeRun(env, RERANKER_MODEL, {
            query: args.query, // raw user query STRING (NOT the embedding vector, NOT a prefixed variant)
            contexts,
          });
          // Response: { response: [{ id: <index into contexts[]>, score: number }] }
          const reranked =
            (rerankResp as { response?: { id: number; score: number }[] }).response ?? [];
          for (const r of reranked) {
            const cand = rankedCandidates[r.id]; // id is the ORIGINAL contexts index (T-03-08)
            if (cand !== undefined) {
              rerankScores.set(cand.id, sigmoid(r.score)); // sigmoid-normalize logit → [0,1]
            }
          }
        } catch (rerankErr) {
          // EXP-06 fallback: reranker 429/error → leave rerankScores empty.
          // Each match falls back to raw cosine via the ?? m.score default below.
          console.warn("recall:EXP-06:reranker-failed", {
            err: rerankErr instanceof Error ? rerankErr.message : String(rerankErr),
          });
        }
      }

      // Apply reranker scores to filteredMatches (or keep raw cosine via defensive default).
      const rerankedMatches = filteredMatches.map((m) => ({
        ...m,
        score: rerankScores.get(m.id) ?? m.score, // ?? m.score = raw-cosine fallback (EXP-06)
      }));

      // === AI-04 Step 4: hybrid re-rank (spike-validated formula: cosine·1.0 + recency·0.15 + type·0.2 + scope·0.15) ===
      // EXP-06: rerankedMatches feeds the `rerank` component (sigmoid-normalized bge-reranker score
      // when available; raw cosine on fallback). Formula UNCHANGED from Phase 2 (D-34 sweep result).
      const ranked = hybridRank(rerankedMatches, blocks, args, Date.now());

      // === CON-05 Step: hydrate inbox-pending conflicts touching the ranked memories ===
      // Severity is computed AT READ TIME per RESEARCH §"Pattern 6" — the inbox row
      // stores raw fields only. PITFALLS CD-5 time-blind mitigation: > 180 days between
      // the two memories → severity="low" per CON-06. "medium" is never produced in v0.2
      // (reserved for v0.3 conflict() tool surface).
      //
      // CON-08 invariant (PULL-ONLY/PASSIVE): conflicts are surfaced in the envelope
      // ONLY because the caller asked (recall). NEVER pushed/alerted proactively.
      const recallIds = ranked.map((r) => r.id);
      let conflicts: Conflict[] = [];
      try {
        // Re-use the existing stub variable — do NOT acquire a second stub.
        const conflictRows = await (
          stub as unknown as {
            listInboxConflictsForMemoryIds: (args: {
              workspace_id: string;
              ids: string[];
            }) => Promise<InboxConflictRow[]>;
          }
        ).listInboxConflictsForMemoryIds({
          workspace_id: props.workspace_id, // ALWAYS from props, NEVER from args (MCP-05 / MT-1)
          ids: recallIds,
        });

        const blockAgeById = new Map<string, number>(ranked.map((b) => [b.id, b.created_at]));
        for (const row of conflictRows) {
          try {
            const parsed = JSON.parse(row.proposed_properties) as InboxConflictProperties;
            // Fall back to row.created_at when the conflicted memory is NOT in the ranked set
            // (RESEARCH §"Pattern 6" lines 517-519 safe-approximation fallback).
            const memA_age = blockAgeById.get(parsed.memory_a_id) ?? row.created_at;
            const memB_age = blockAgeById.get(parsed.memory_b_id) ?? row.created_at;
            const diffDays = Math.abs(memA_age - memB_age) / (1000 * 60 * 60 * 24);
            // CON-06 + CD-5: > 180 days → "low"; otherwise "high". "medium" NOT used in v0.2.
            const severity: "low" | "high" = diffDays > 180 ? "low" : "high";
            conflicts.push({
              id: row.id,
              memory_a_id: parsed.memory_a_id,
              memory_b_id: parsed.memory_b_id,
              description: parsed.description,
              severity,
              detected_at: row.created_at,
              resolved_at: null, // v0.2: resolution is v0.3 conflict() tool surface
            });
          } catch (parseErr) {
            // Malformed proposed_properties — skip this row silently (T-02-08-01 mitigation).
            console.warn("recall:CON-05:inbox-conflict-parse-failed", {
              row_id: row.id,
              err: parseErr instanceof Error ? parseErr.message : String(parseErr),
            });
          }
        }
      } catch (rpcErr) {
        // Conflicts envelope is AUXILIARY — recall MUST NEVER fail because of it (T-02-08-01).
        console.warn("recall:CON-05:rpc-failed", {
          err: rpcErr instanceof Error ? rpcErr.message : String(rpcErr),
        });
        conflicts = [];
      }
      // === End CON-05 Step ===

      // === D-01: synthesis is OPT-IN — skipped on default verbosity="chunks" (no 2–5s latency penalty) ===
      let synthesis: string | null = null;
      // Synthesis gaps accumulated during the block; merged into envelope.meta.gaps after
      // buildRecallResponse (same pattern as queryWasTruncated / expansionUnavailable — EXP-10).
      const synthesisGaps: string[] = [];

      // SYN-07: single-memory synthesis is not useful — skip and note in meta.gaps.
      if (
        (args.verbosity === "synthesis" || args.verbosity === "both") &&
        ranked.length < 2
      ) {
        synthesisGaps.push("synthesis skipped: only one source");
        // synthesis stays null; fall through to buildRecallResponse
      }

      if (
        (args.verbosity === "synthesis" || args.verbosity === "both") &&
        ranked.length >= 2
      ) {
        // AI-SPEC.md §4b "Context Window Strategy": cap synthesis input at ~6K tokens.
        // Drop trailing memories first (lowest-ranked position after hybridRank).
        // SYN-05: trimRankedForSynthesis throws when ALL memories exceed budget;
        // the catch below handles it via honest-stubs posture.
        const synthStart = Date.now();
        // SYN-06: compute lowConfidence flag BEFORE safeRun, from cosine scores of trimmed set.
        // Must be computed here (before the try/catch) so it's in scope for post-processing.
        let lowConfidence = false;
        let trimmedForSynth: LexicalSearchHit[] = [];
        let synthInput = "";
        try {
          trimmedForSynth = trimRankedForSynthesis(ranked, 6000);
          // SYN-06: lowConfidence = min(cosine over trimmed set) < 0.7
          const cosineScores = trimmedForSynth.map((m) => m.score ?? 0);
          const minCosine = cosineScores.length > 0 ? Math.min(...cosineScores) : 0;
          lowConfidence = minCosine < 0.7;

          synthInput = formatBlocksForSynthesis(trimmedForSynth, args.query);

          const synthResp = await safeRun(env, CLASSIFIER_MODEL, {
            messages: [
              { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
              { role: "user", content: synthInput },
            ],
            temperature: 0.3,
            max_tokens: 1024,
          });
          synthesis = typeof synthResp.response === "string" ? synthResp.response : null;

          // Post-processing chain (runs AFTER safeRun, BEFORE writeAnalytics):
          // SYN-06: hedge prefix, D-02: position→id mapping, D-09: uncited-sentence drop.
          if (synthesis !== null) {
            synthesis = applyHedgePrefix(synthesis, lowConfidence); // SYN-06
            synthesis = mapPositionsToCitationIds(synthesis, trimmedForSynth); // D-02
            synthesis = dropUncitedSentences(synthesis, trimmedForSynth, {
              lowConfidenceHedge: lowConfidence,
            }); // D-09
          }

          // SYN-09: blobs[1]="synthesis" (operation-kind discriminator); doubles[1]=estimated token count.
          writeAnalytics(env, {
            blobs: ["mcp-server", "synthesis", wsTag, "success"],
            doubles: [Date.now() - synthStart, Math.ceil(synthInput.length / 4), 0, 0],
            indexes: [ANALYTICS_ENV_TAG],
          });
        } catch (synthErr) {
          // Per CONTEXT.md D-07 honest-stubs posture — synthesis failures leave synthesis=null;
          // meta.gaps surfaces the failure rather than crashing the recall.
          console.warn("recall:synthesis-failed", { synthErr });

          // SYN-05: surface preflight failure in meta.gaps.
          if (
            synthErr instanceof Error &&
            synthErr.message.includes("synthesis-preflight:")
          ) {
            synthesisGaps.push("synthesis skipped: context exceeded 6K token budget");
          }

          const synthOutcome =
            synthErr != null && typeof synthErr === "object" && "isRateLimit" in synthErr
              ? "retry-429"
              : "synthesis-failed";

          // SYN-09: blobs[1]="synthesis" (operation-kind discriminator).
          writeAnalytics(env, {
            blobs: ["mcp-server", "synthesis", wsTag, synthOutcome],
            doubles: [Date.now() - synthStart, 0, 0, synthOutcome === "retry-429" ? 1 : 0],
            indexes: [ANALYTICS_ENV_TAG],
          });
          synthesis = null;
        }
      }

      // === D-02: discoverability triad — populate suggestions ONLY when verbosity="chunks" ===
      const suggestions =
        args.verbosity === "chunks"
          ? { actions: ["Set verbosity: 'synthesis' to add a summary of these memories."] }
          : undefined;

      const envelope = buildRecallResponse({
        memories: ranked,
        verbosity: args.verbosity,
        synthesis,
        ...(suggestions !== undefined ? { suggestions } : {}),
        // CON-05: pass the conflict array; buildRecallResponse conditionally-spreads
        // it into context.conflicts (omits entirely when empty — T-02-08-05).
        conflicts,
      });
      // T-05-05-TRUNC backfill: append the recall-query truncation gap when applicable.
      // Done AFTER buildRecallResponse so the gap survives trimToBudget (which preserves meta.gaps).
      if (queryWasTruncated) {
        envelope.meta.gaps = [...envelope.meta.gaps, META_GAPS.recallQueryTruncated];
      }
      // EXP-10: append meta.gaps note when query expansion fell back to single-query.
      // Done AFTER buildRecallResponse so the gap survives trimToBudget.
      if (expansionUnavailable) {
        envelope.meta.gaps = [...envelope.meta.gaps, META_GAPS.queryExpansionUnavailable];
      }
      // SYN-07/SYN-05: merge synthesis-specific gaps (single-source skip, preflight overflow).
      // Done AFTER buildRecallResponse, same pattern as queryWasTruncated/expansionUnavailable.
      if (synthesisGaps.length > 0) {
        envelope.meta.gaps = [...envelope.meta.gaps, ...synthesisGaps];
      }

      // EXP-11: single end-to-end recall latency datapoint (op-kind 'recall').
      // doubles[0]=total handler latency, [1]=ranked-result count, [2]=fan-out fired,
      // [3]=expansion-unavailable (degraded path). Lets the production p50/p99 SLA be a
      // one-row Analytics Engine query (blob2='recall') instead of summing per-op latencies.
      writeAnalytics(env, {
        blobs: ["mcp-server", "recall", wsTag, ranked.length === 0 ? "zero-match" : "success"],
        doubles: [Date.now() - recallStart, ranked.length, fanOutFired ? 1 : 0, expansionUnavailable ? 1 : 0],
        indexes: [ANALYTICS_ENV_TAG],
      });

      return wrapMcpContent(trimToBudget(envelope));
    } catch (err) {
      throw mapToMcpError(err);
    }
  });

  // search(query, filters)
  // prettier-ignore
  server.registerTool("search", {
    description: "Structured filter-based search of memories.",
    inputSchema: SearchInputSchema.shape,
  }, async (args) => {
    const props = getProps();
    if (props === undefined) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Missing authentication context",
      );
    }
    try {
      const stub = workspaceNs.get(workspaceNs.idFromName(props.workspace_id));
      // args.filters accepted by schema but not yet applied by v0.1 DO method (lexical only — see META_GAPS.search; Phase 5 implements structured filter expressions)
      // eslint-disable-next-line @typescript-eslint/await-thenable -- DO stub methods return Promise<T> at runtime via Cloudflare RPC layer even though declared sync
      const memories = await stub.lexicalSearchBlocks({
        workspace_id: props.workspace_id, // ALWAYS from props, NEVER from args
        query: args.query,
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });
      const envelope = buildSearchResponse({ memories });
      return wrapMcpContent(trimToBudget(envelope));
    } catch (err) {
      throw mapToMcpError(err);
    }
  });

  // forget(id, cascade?)
  // prettier-ignore
  server.registerTool("forget", {
    description: "Delete a memory and optionally its related memories.",
    inputSchema: ForgetInputSchema.shape,
  }, async (args) => {
    const props = getProps();
    if (props === undefined) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Missing authentication context",
      );
    }
    try {
      const stub = workspaceNs.get(workspaceNs.idFromName(props.workspace_id));

      // === Phase 5 AI-08: Vectorize delete FIRST (per RESEARCH §Pattern 3a + Open Question 3) ===
      // Ordering rationale: Vectorize FIRST prevents the ghost-recall failure mode (T-05-03-GHOST).
      // Partial-failure analysis:
      //   (a) Vectorize delete fails → SQLite stays; mapToMcpError surfaces the error; user retries.
      //       Recall continues to return the block (vector still present). Acceptable.
      //   (b) SQLite delete fails after Vectorize succeeds → orphan SQLite row. Harmless because
      //       recall via Vectorize no longer finds the vector. Background sweep (Wave 6) cleans up.
      // Vectorize deleteByIds is idempotent — forgetting an id not in the index returns success.
      // workspaceTag memoized here — only 1 analytics call in forget handler.
      const forgetWsTag = await workspaceTag(props.workspace_id);
      const deleteStart = Date.now();
       
      await vectorizeDelete(env, props.workspace_id, [args.id]);
       
      writeAnalytics(env, {
        blobs: ["mcp-server", "vectorize-delete", forgetWsTag, "success"],
        doubles: [Date.now() - deleteStart, 1, 0, 0],
        indexes: [ANALYTICS_ENV_TAG],
      });

      // === Phase 4 path preserved: SQLite cascade ===
      // Pitfall 4: deleteBlock returns {blocks_deleted: 0, relations_deleted: 0} on bogus id — do NOT synthetically throw NotFoundError. Echo the truth (idempotent semantics; CONTEXT.md "forget(cascade) semantics").
      const { blocks_deleted, relations_deleted } = await stub.deleteBlock({
        workspace_id: props.workspace_id, // ALWAYS from props, NEVER from args
        id: args.id,
        cascade: args.cascade ?? true,
      });
      const envelope = buildForgetResponse({ id: args.id, blocks_deleted, relations_deleted });
      return wrapMcpContent(trimToBudget(envelope));
    } catch (err) {
      throw mapToMcpError(err);
    }
  });

  // ingest(source, type?, project?, priority?, threshold?)
  /* eslint-disable @typescript-eslint/require-await -- D-05: ingest has no await in v0.1; async is kept so v0.4 connectors (Slack channel ingestion, Google Drive polling) add the Queue producer body — Phase 6 left ingest as a stub per Phase 6 CONTEXT.md D-02 */
  // prettier-ignore
  server.registerTool("ingest", {
    description: "Queue an external content source for async enrichment.",
    inputSchema: IngestInputSchema.shape,
  }, async () => {
    const props = getProps();
    if (props === undefined) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Missing authentication context",
      );
    }
    try {
      // Route-by-DO-id check (TOL-07 Prong A). v0.4 connectors will use the resolved stub to call ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent)) — Phase 6 CONTEXT.md D-02 deferred this body to v0.4.
      void workspaceNs.get(workspaceNs.idFromName(props.workspace_id));
      const job_id = crypto.randomUUID();
      const envelope = buildIngestResponse({ job_id });
      return wrapMcpContent(trimToBudget(envelope));
    } catch (err) {
      throw mapToMcpError(err);
    }
  });
  /* eslint-enable @typescript-eslint/require-await */
}
