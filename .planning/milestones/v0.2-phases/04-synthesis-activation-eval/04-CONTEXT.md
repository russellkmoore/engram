# Phase 4: Synthesis Activation Eval - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Promote the **already-scaffolded** `verbosity=synthesis|both` branch in `recall()` from "implemented but unvalidated" to "shipped behind an LLM-judge eval gate." The synthesis call, `SYNTHESIS_SYSTEM_PROMPT`, `trimRankedForSynthesis`, `formatBlocksForSynthesis`, and the analytics write already exist in `packages/mcp-server/src/tools.ts` (Phase 5 of v0.1 scaffolded them as opt-in, honest-stub). Phase 4's job is the **eval gate + the production-quality post-processing** that makes the path trustworthy enough to expose.

**In scope:** synthesis-fidelity eval (LLM-judge faithfulness ≥90%, zero hallucinated entities), citation density enforcement (SYN-03), 6K-token preflight assertion (SYN-05), cosine-aware hedging (SYN-06), single-memory rejection (SYN-07), latency contract (SYN-04: p50 ≤5s / p99 ≤8s), analytics blob extension (SYN-09), `expected_synthesis` corpus augmentation (SYN-01).

**Out of phase boundary (locked):**
- Flipping the `verbosity` default from `"chunks"` to `"both"` — that is v0.3 (SYN-08 / D-7).
- Specializing `SYNTHESIS_MODEL` off the Scout alias — stays aliased (SYN-10).
- `reflect()` deep synthesis (separate v0.3 tool), kitchen-sink composition (Phase 5), proactive notifications (forbidden architecturally).

</domain>

<decisions>
## Implementation Decisions

### Citation strategy (SYN-03 vs SYN-10 byte-freeze)

- **D-01:** **Keep `SYNTHESIS_SYSTEM_PROMPT` byte-frozen** (honors SYN-10). The model continues to cite memories **by position** ("memory 1 / memory 2"). Do NOT edit the prompt to emit `[memory_id]` markers — a prompt change would break the spike-findings §6 byte-stable contract AND force a full eval re-run, and feeding raw block_ids into the prompt risks the model fabricating/mangling them (a direct SYN-02 hallucination vector).
- **D-02:** **Convert position → `[memory_id]` in post-processing**, deterministically, from the ranked list ordering (`ranked[i]` ↔ "memory i+1"). This is the single source that produces SYN-03's inline `[block_id]` markers. The mapping is mechanical and cannot hallucinate.
- **D-03:** **Out-of-range citation guard:** if the model cites "memory N" where N exceeds the number of memories actually supplied to the synthesis call (e.g. cites "memory 5" when 4 were passed after `trimRankedForSynthesis`), the citation is invalid → the containing sentence is dropped by the SYN-03 post-processor (see D-09). This doubles as a SYN-02 hallucination guard.

### LLM-judge setup (SYN-01, SYN-02)

- **D-04:** **Judge with a LARGER Workers AI model than the generator.** Generator stays Scout (`llama-4-scout-17b`, SYN-10). Judge uses a stronger CF model (target: `@cf/meta/llama-3.3-70b-instruct` or the strongest available `workerd`-compatible CF judge at plan time — researcher confirms current availability). Rationale: Scout-judging-Scout is self-lenient and undermines the 90% gate's meaning. Staying on CF AI keeps the all-CF-AI principle, adds no vendor/secret/CI-egress.
- **D-05:** **Eval framework = extend the existing vitest `.eval.test.ts` harness**, NOT promptfoo. The entire eval suite is already vitest (`recall-f1.eval.test.ts`, `recall-ranking.eval.test.ts`, `reranker-ablation.eval.test.ts`, `recall-latency.eval.test.ts`). New file: `synthesis-fidelity.eval.test.ts` in the same `__tests__/evals/` directory, runs in the `eval` tier under the existing `MAX_AI_CALLS ≤ 200` budget guard (PRE-02). ROADMAP's "promptfoo + LLM-judge" wording is descriptive, not binding — adding a second toolchain for one eval isn't justified. (v0.1 AI-SPEC §6 already names the "Promptfoo + Vitest custom + Analytics Engine" composition; we take the Vitest-custom leg.)
- **D-06:** The judge is an **LLM-as-judge against the SOURCE MEMORIES** for the hard faithfulness gate (SYN-02): "does every claim in the synthesis trace to a supplied memory; are any entities fabricated." This gate does NOT depend on `expected_synthesis` captions.

### Ground-truth captions (SYN-01)

- **D-07:** **`expected_synthesis` captions are AI-drafted, no human review**, generated once and committed into the corpus. They feed ONLY a **secondary completeness/coverage signal** ("did synthesis surface what a good answer should cover"), never the hard faithfulness gate (which judges against source memories per D-06). Because the catastrophic gate is caption-independent, unreviewed captions cannot corrupt it — worst case the completeness number is slightly noisy. This avoids the 3–4hr manual-labeling critical path that Phase 1/2 incurred.
- **D-08:** Caption coverage and authoring model are the planner/researcher's discretion within D-07's constraint (drafted by a frontier-grade model, committed to `.planning/evals/recall-corpus.json` augmentation + synced fixture per the Phase 2 D-11..D-14 corpus-sync pattern). Default to captioning the **30-entry validate split** (consistent with Phase 2's held-out discipline) unless research shows full-corpus captioning is cheap enough.

### Citation post-processing aggressiveness (SYN-03)

- **D-09:** **Drop uncited sentences EXCEPT** (a) the leading hedge sentence emitted on the cosine-<0.7 low-confidence path (SYN-06) and (b) explicit gap-acknowledgment sentences. Those are citation-less *by design* and are exactly the honesty signals we want to preserve; strict-dropping them would delete the hedging the phase requires. Every other sentence must carry a valid `[memory_id]` (post-D-02 mapping) or it is removed. Soft-flag-only enforcement is rejected — SYN-03 must be a real gate, not a warning.

### Eval / process discipline (carried pattern)

- **D-10:** **Create `.planning/phases/04-synthesis-activation-eval/04-CF-CODE-ASSIST-USAGE.md`** scaffolded with the same 3-question-checklist columns as Phase 1/2 (PRE-05 pattern). Every code-producing task in Phase 4 appends one row. Likely cf-code-assist shapes for this phase: `synthesis-fidelity.eval.test.ts` scaffold (`scaffoldTests` — judge-call loop + metric helpers + tier-budget assertion), the position→`[memory_id]` post-processor (`generateCode` — deterministic string transform with a pinned contract), the caption-generation script (`generateCode`). Stays-with-Claude: the byte-frozen-prompt-adjacent wiring, the SYN-02 judge-prompt authoring (faithfulness rubric is a correctness-critical contract), analytics blob-shape changes (cross-file with the existing `writeAnalytics` callers).

### Claude's Discretion

- Exact judge prompt / faithfulness rubric wording (researcher drafts, must encode "trace every claim to a source memory; zero fabricated entities").
- Caption-generation model + exact coverage count within D-07/D-08.
- Where the position→id post-processor lives (file-local helper in `tools.ts` vs extracted), provided it runs before `buildRecallResponse`.
- Token-count estimation method for the 6K preflight (the scaffold uses ~4 chars/token; refine if needed).

</decisions>

<specifics>
## Specific Ideas

- The synthesis path is **already scaffolded and opt-in** — this phase hardens + gates it, it does NOT build it from scratch. Treat the existing `tools.ts` synthesis block (lines ~793–836) and `SYNTHESIS_SYSTEM_PROMPT` (lines ~126–134) as the contract surface to validate, not rewrite.
- Faithfulness is the trust-killer Russell will personally catch within weeks of ship — the ≥90% gate + zero-hallucinated-entities is non-negotiable and BLOCKS the phase, not just the eval (ROADMAP Risk Note SY-1/SY-2).
- "Byte-frozen prompt" means: any future synthesis prompt edit costs a full eval re-run. Document this cost in the plan so it's a deliberate decision, not a casual keystroke (ROADMAP Risk Note SYN-10).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements + risk notes
- `.planning/ROADMAP.md` § "Phase 4: Synthesis Activation Eval" — SYN-01..SYN-10 success criteria + Risk Notes (SY-1/SY-2 hallucination, SY-3 context overrun, SY-6 latency, byte-freeze, D-7 default-stays-chunks).

### Synthesis contract (the byte-frozen surface)
- `.claude/skills/spike-findings-engram/SKILL.md` § "EngramResponse synthesis contract (Phase 4)" — synthesis-only fidelity ~84–90% on synthetic; 5 drop categories; honest-stubs; default-`chunks` supersession note.
- `.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md` — full synthesis fidelity findings + the 5 system-prompt drop categories the byte-frozen prompt encodes.
- `packages/mcp-server/src/tools.ts` §§ ~114–180 (`SYNTHESIS_SYSTEM_PROMPT`, `trimRankedForSynthesis`, `formatBlocksForSynthesis`) and ~793–845 (the opt-in synthesis block + suggestions triad) — the scaffold being activated.

### AI systems best-practices + eval tooling
- `.planning/milestones/v0.1-phases/05-ai-integration/05-AI-SPEC.md` §4b "AI Systems Best Practices" (Context Window Management — the 6K strategy SYN-05 references), §6 (eval tooling: Promptfoo + Vitest-custom + Analytics Engine composition — we take the Vitest leg per D-05), §7 (Analytics Engine blob/index schema SYN-09 extends).

### Eval corpus + sync pattern
- `.planning/evals/recall-corpus.json` — 100-entry authoritative corpus to augment with `expected_synthesis` (SYN-01).
- `.planning/phases/02-recall-quality-baseline/02-CONTEXT.md` D-11..D-15 — corpus single-source-of-truth + `scripts/sync-eval-corpus.mjs` + vendored-fixture discipline to mirror for the caption augmentation.

### Model + config constants
- `shared/ai-config/src/index.ts` — `SYNTHESIS_MODEL` (Scout alias, SYN-10), `INGESTION_CLASSIFIER_MODEL`, candidate judge models. Judge model (D-04) lands here if a new constant is added.

### Process tracker
- `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` — the PRE-05 tracker template to copy for `04-CF-CODE-ASSIST-USAGE.md` (D-10).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Synthesis scaffold** (`packages/mcp-server/src/tools.ts` ~793–836): opt-in branch, `safeRun(env, CLASSIFIER_MODEL, …)` call, try/catch with honest-stub `synthesis=null` fallback, `writeAnalytics` on both success and failure paths. Activate + harden, don't rebuild.
- **`trimRankedForSynthesis(memories, 6000)`**: already implements the SYN-05 drop-trailing-first strategy at ~4 chars/token. SYN-05 wants this to be a hard assertion + a `meta.gaps` note on truncation — extend the existing helper.
- **`writeAnalytics` + `ANALYTICS_ENV_TAG`**: synthesis already writes `blobs:["mcp-server", model, wsTag, outcome]`, `doubles:[latency_ms, input_len, 0, 0]`. SYN-09 wants `blobs[1]="synthesis"`, `doubles[0]=latency_ms`, `doubles[1]=token_count` — reconcile the blob/double layout with the existing schema (cross-file with other `writeAnalytics` callers — Claude work, D-10).
- **vitest `eval` tier + `MAX_AI_CALLS ≤ 200` budget guard** (PRE-02): the new judge-driven eval runs here; reuse `scripts/eval-budget-summary.mjs` for the neuron summary.
- **Corpus sync rig** (`scripts/sync-eval-corpus.mjs`, vendored `recall-corpus-v2.json` fixture): mirror for caption-augmented corpus.

### Established Patterns
- **Honest-stubs posture (v0.1 D-04, locked):** synthesis failures leave `synthesis=null` and surface via `meta.gaps` — never crash recall, never fake with a heuristic template. SYN-07 single-memory rejection and SYN-05 truncation both use the `meta.gaps` channel.
- **Opt-in only:** synthesis fires ONLY on `verbosity ∈ {synthesis, both}`; `chunks` (default) pays zero latency and gets the discoverability suggestion instead. Preserve this branch exactly.
- **Train/validate split discipline (Phase 2):** held-out validate split for any quality claim; mirror for caption coverage (D-08).

### Integration Points
- Post-processor (position→`[memory_id]`, D-02) + citation-drop (D-09) run on `synthesis` string AFTER the `safeRun` call and BEFORE `buildRecallResponse({ … synthesis … })`.
- New judge model constant (D-04) → `shared/ai-config/src/index.ts`.
- SYN-09 analytics changes touch every `writeAnalytics` caller in the synthesis block — keep blob/double indices consistent with the v0.1 AI-SPEC §7 schema.

</code_context>

<deferred>
## Deferred Ideas

- **Flip `verbosity` default to `"both"`** — v0.3, gated on the SYN-09 adoption analytics this phase emits (D-7 lock).
- **Specialize `SYNTHESIS_MODEL` to a frontier/long-context model** (e.g. kimi-style 256K for cross-memory synthesis) — v0.3+, off the Scout alias (SYN-10 lock).
- **promptfoo adoption** as a broader eval harness — reconsider if/when eval count grows beyond what vitest-custom comfortably holds; out of scope here (D-05).
- **Human-reviewed `expected_synthesis` captions** — if the secondary completeness signal proves too noisy to act on, a review pass becomes a v0.3 quality task (D-07).

</deferred>

---

*Phase: 04-synthesis-activation-eval*
*Context gathered: 2026-06-09*
