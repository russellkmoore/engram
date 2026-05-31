---
id: SEED-001-DESIGN
parent_seed: SEED-001
status: draft
authored: 2026-05-31
authored_by: ENG-8 backlog sweep (Claude, autonomous)
trigger_status: still dormant — design analysis pre-positioned for v0.3 milestone planning
informs: v0.3 — Workspaces + Memory Types (target 2026-07-12)
linear: ENG-17
---

# SEED-001 design analysis — Cross-layer recall fan-out (UserDO + TeamDO + ProjectDO)

> **Purpose.** Narrow the design space for v0.3 cross-layer recall **before** the
> first v0.3 phase is planned. This document answers what can be answered from
> current Cloudflare docs + v0.1 source, and explicitly defers what only a
> running spike can resolve. It is the input to `/gsd:spike cross-layer-recall`
> when v0.3 begins.
>
> **Out of scope.** No code is written. No phase is created. The seed remains
> `dormant`; this analysis is the digested reading that the seed action calls
> for ("Read the seed file in full before v0.3 milestone planning").

---

## 0. v0.1 baseline (what we ship today)

- **One DO per workspace.** `WorkspaceDO` owns one SQLite store per
  `workspace_id`. The MCP Worker is a thin router: JWT → `workspace_id` →
  `getAgentByName(env.WORKSPACE, workspace_id)` → single RPC call.
- **One Vectorize index, namespace = `workspace_id`.** Enforced 64-byte cap
  in `packages/mcp-server/src/vectorize-helper.ts:49–62` (`assertNamespaceSize`).
  Every query/upsert targets a single namespace.
- **Hybrid rerank in `mcp-server`.** `hybridRank` is a pure function:
  `score = cosine·1.0 + recency·0.15 + type_match·0.2 + scope_match·0.15`.
  All inputs come from a single DO's SQLite hydration + single Vectorize
  namespace query.
- **No cross-DO read paths exist.** Phase 5 deliberately scoped to one DO per
  recall. The v0.3 fan-out is a brand-new code path, not an extension of one.

This baseline is the cliff edge SEED-001 warned about: every assumption that
makes v0.1 simple breaks the moment a `recall()` must traverse N stores.

---

## 1. Cloudflare platform constraints (current, 2026-05-31)

Sourced from CF docs via the developer-platform MCP. Cite each before
locking a design choice.

### 1.1 Subrequest limits (NOT the binding constraint)

| Tier         | Subrequests / invocation |
|--------------|-------------------------:|
| Workers Free | 50                       |
| Workers Paid | **10,000** (max 10M)     |

DO RPC calls count as subrequests. Fan-out to 100 DOs uses 100 of the 10,000
budget. **Subrequests are NOT what limits us.**

### 1.2 Simultaneous open connections — the real cap

> "Each Worker invocation can have up to **six connections** simultaneously
> waiting for response headers."
> — `workers/platform/limits/#simultaneous-open-connections`

This is the parallelism cap, not the subrequest count. A naive
`Promise.all([stub1.recall(), stub2.recall(), …, stub20.recall()])` will
serialize past the 6-connection ceiling. Two paths to mitigate:

1. **Bounded concurrency pool** — chunk the fan-out into batches of 6 and
   `await Promise.all` per batch. Simple, but adds (N/6 - 1) × p95 latency.
2. **Fan-out coordinator DO** — single connection from MCP Worker to a
   coordinator DO, which itself fans out. The coordinator DO has its own
   6-connection cap, so this only buys one extra hop, not unlimited parallelism.
3. **AI Search namespace binding** (changelog 2026-04-16, see §3.4) — single
   binding call internally fans out across `instance_ids`. We may not be able
   to use this for raw vectors, but worth a spike measurement.

### 1.3 Service Bindings cap (NOT applicable — we use DO RPC, not service bindings)

32 Worker invocations max per request. DO RPC sessions are billed/counted
differently — see §1.4. Note for the record so a future design doesn't
confuse the two.

### 1.4 DO RPC billing — each call is one billable request

> "Each [RPC method call] on a [Durable Objects stub] is its own RPC session
> and therefore a single billed request."
> — `durable-objects/platform/pricing/`

**Cost implication.** Fan-out to N DOs per `recall()` = N billed DO requests
per recall. At Workers Paid pricing ($0.15/M requests), 100 fan-outs/recall ×
1000 recalls/day = 100K DO requests/day = ~$0.45/month just for fan-out
sessions. Negligible at v0.3 scale; meaningful at v0.4 if a chatty connector
triggers recalls.

**Multiplexing escape hatch.** A stub method can return an `RpcTarget` and
subsequent calls on the returned stub are **free** within the same session:

```ts
using fanout = await coordinatorStub.openFanout(query);  // 1 billed request
await fanout.queryLayer("personal");                     // same session, free
await fanout.queryLayer("team");                         // same session, free
```

This is the only path to keep fan-out cost flat as N grows.

### 1.5 DO hibernation — cold-start tax on rarely-touched layers

A DO hibernates after **10 seconds** of no incoming request + no pending
awaits/timers/WS. Cold restart re-runs `constructor()`. v0.3 implication:

- A user's **UserDO** is touched often → usually warm.
- The user's primary **TeamDO** is touched moderately → mostly warm.
- A **ProjectDO** for a project the user hasn't touched in a week → cold.

Cold-start variance from spike 003 was 5–13 seconds for AI binding boot.
DO cold-start is faster (no model load) but still adds 50–200ms per cold DO.
A fan-out across 20 cold ProjectDOs adds visible latency.

**Mitigation:** keep ProjectDO membership in the UserDO (cheap KV-ish reads),
and only fan out to ProjectDOs the user has touched in the last N days.
Older ProjectDOs fall back to a slower "deep search" tier (async, returned
via `meta.gaps` in the envelope).

### 1.6 DO single-threading + 1000 req/sec soft cap

Each DO is single-threaded (Cloudflare docs: "An individual Object has a
soft limit of 1,000 requests per second"). v0.3 fan-out is many small reads
across many DOs — well under the per-DO cap. Not a binding constraint.

### 1.7 Vectorize namespaces

| Constraint                  | Value                |
|-----------------------------|----------------------|
| Max namespaces per index    | **1,000**            |
| Namespace name length       | 64 bytes (UTF-8)     |
| Namespace specified in query| Single namespace per query call |
| Filtering order             | Namespace applied **before** vector search |

**The 1,000 cap is the schema-design hammer.** If v0.3 uses one namespace
per (User|Team|Project)DO, an account with 333 projects + 333 teams + 333
users exhausts the index. Mitigations to evaluate at spike time:

1. **Namespace = scope-bucket, not DO-id.** Use `personal:{user_id}`,
   `team:{team_id}`, `project:{project_id}` and shard across multiple
   Vectorize indexes when buckets grow.
2. **Namespace = `org_id`, scope filtering via metadata.** Use a metadata
   index (limit 10 metadata indexes/index) on `scope` + `project_id`. Metadata
   filtering is applied before vector search; namespace+metadata both narrow
   the search space. Documented as supported in `vectorize/reference/metadata-filtering/`.
3. **Hybrid: namespace = `tenant_id`, metadata for sub-scoping.** Lets v0.3
   ship with one namespace per tenant and dial up sharding when accounts
   approach 1,000 sub-scopes.

Posture recommendation: **option 2 (tenant namespace + scope metadata index)**.
Keeps v0.3 within the 1,000-namespace cap until a single tenant has 1,000+
projects, at which point the sharding choice can be made with real data.

### 1.8 Cross-namespace querying — NOT natively supported in raw Vectorize

The current Vectorize `query()` accepts a single `namespace` string. There
is no `namespaces: string[]` form. **To query across N namespaces with the
raw binding you must call `query()` N times.** Each call is 1 subrequest.

**AI Search (formerly AutoRAG) DOES support multi-namespace fan-out**
via `ai_search_options.instance_ids: string[]`, returning one ranked list
with `instance_id` per chunk (changelog 2026-04-16). But:

- AI Search is a managed RAG layer on top of Vectorize, not a drop-in for
  raw Vectorize query.
- It owns its own chunking + indexing pipeline; switching means rebuilding
  Engram's ingest path on AI Search semantics.
- Likely too invasive for v0.3. Worth a 30-minute eval at spike time to
  confirm or rule out.

**Default assumption for v0.3 design:** raw Vectorize, N namespace queries,
parallelized within the 6-connection cap. AI Search is a v0.5+ rewrite, not
a v0.3 quick win.

---

## 2. The six design questions (from SEED-001), answered

### Q1. Fan-out mechanism

**Options:**

| Option | Latency | Failure mode | Cost (DO req) |
|---|---|---|---|
| A. Sequential N × `await stub.recall()` | N × p95 | Trivial: skip-on-error | N |
| B. `Promise.all` (naive) | p95 capped by 6-conn limit | Whole call fails if any rejects | N |
| C. `Promise.allSettled` with bounded concurrency (batch of 6) | (N/6) × p95 | Per-layer fail tolerated | N |
| D. Fan-out coordinator DO + RpcTarget multiplexing | (N/6) × p95 + 1 hop | Coordinator failure = total fail | 1 (per recall) |

**Recommendation:** start with **C** (`Promise.allSettled` + 6-wide concurrency
pool) for v0.3 phase 1. Defer **D** to v0.4 when (a) cost matters because
recalls are high-frequency, (b) the coordinator can colocate with the user's
UserDO for free, or (c) connector traffic justifies the multiplexing.

`allSettled` is required, not `all` — when one ProjectDO is cold/overloaded,
the recall must still return UserDO + TeamDO + other-ProjectDO results. Per-DO
failure surfaces in `EngramResponse.meta.gaps: string[]` (already in v0.1
envelope) as `"project:{id} unreachable"`.

### Q2. Vectorize score comparability across namespaces

**Empirically:** same embedding model (`bge-base-en-v1.5`) → same vector
space → cosine distances ARE mathematically comparable across namespaces.
This is true by construction; not a CF promise.

**Risk:** distribution shift. A UserDO with 50 personal notes has different
score-distribution shape than a TeamDO with 5,000 shared docs. The top-1 in
the 50-item store may score 0.74 (high relative to its peers), while the
top-1 in the 5,000-item store may score 0.78 (lower relative percentile but
higher absolute cosine). Naive merge by raw cosine biases toward the larger
store.

**Two normalization strategies to spike:**

1. **Reciprocal Rank Fusion (RRF).** `score(d) = Σ_i 1/(k + rank_i(d))`.
   Scale-free, popular for federated search. Loses absolute cosine signal.
2. **Per-namespace z-score normalization.** `z = (cosine - μ_ns) / σ_ns`,
   then merge by z. Preserves "how good for this layer" signal. Needs
   per-namespace rolling stats (cheap to maintain in DO).

**Recommendation:** spike both on 30 cross-layer queries; pick the one that
better matches hand-curated "right answer ranking." Default to RRF if both
are within 5% — it has fewer moving parts.

### Q3. Result merge + re-rank algorithm

The v0.1 hybrid-rank formula already exists:
`cosine·1.0 + recency·0.15 + type_match·0.2 + scope_match·0.15`.

**For cross-layer it grows two cross-cutting signals:**

| Signal | Why | Default weight to spike |
|---|---|---|
| `layer_priority` | "personal first, then project, then team" for personal queries | 0.10 |
| `requester_match` | Block authored/touched by requester ranks higher | 0.05 |

`scope_match` (already in v0.1) handles "user asked for project X → boost
project=X blocks." `layer_priority` is the **new** signal — it expresses
"I trust my own notes over the team's over the org's" which is product
intent, not vector geometry.

Posture: **keep cosine·1.0 the dominant weight**, treat layer/requester
signals as tiebreakers (≤0.1 weight each). Avoid the trap of letting
heuristics override vector relevance.

### Q4. Deduplication across layers

**The hard case:** a block in UserDO with `relations` pointing to a block
in TeamDO, where both fan-out responses hit the same query. Two stores,
two records, same logical fact.

**Two dedup strategies:**

1. **By block ID.** Trivial — UserDO and TeamDO own disjoint ID spaces
   (UUIDs). Same logical fact in two stores = two distinct IDs = NOT a
   duplicate by this rule.
2. **By content hash.** SHA-256 over normalized content. Catches genuine
   duplicates but requires hashing every block at ingest (cheap, but a new
   schema column).

**Recommendation:** ship v0.3 with ID-based dedup only. Add a `content_hash`
column **opportunistically** at ingest time (does not block v0.3); content-hash
dedup activates in v0.4 when connectors increase the duplicate rate.

**Tie-break when same content surfaces twice:**
1. Highest layer-priority (personal > project > team)
2. Highest individual score
3. Most recent `updated_at`
First-rule-wins, log to `meta.gaps` as `"deduped {id_dropped} for {id_kept}"`.

### Q5. Latency budget

**Anchor:** v0.1 `recall()` ships at p95 ~800ms for a single DO + single
Vectorize namespace query (per spike 003 + Phase 5 verification). v0.3
fan-out target should not exceed **2× v0.1 baseline** = p95 ~1600ms.

**Budget breakdown for v0.3 cross-layer recall (p95 target):**

| Stage | Budget (ms) | Source |
|---|---:|---|
| Auth + workspace resolve | 50 | v0.1 baseline |
| Query expansion (CF AI) | 250 | v0.1 baseline |
| **Fan-out: 6 Vectorize namespace queries (parallel)** | **450** | 1× v0.1 Vectorize p95 |
| **Fan-out: N DO hydration calls (batched 6-wide)** | **300** | ~2× v0.1 DO read p95 |
| Merge + cross-layer rerank | 50 | pure-fn, no I/O |
| Envelope build + return | 100 | v0.1 baseline |
| Headroom | 400 | cold-start + retry |
| **Total p95** | **1600** | 2× v0.1 single-DO recall |

This budgets for **6 DOs warm + 0 ProjectDOs cold**. Cold ProjectDOs eat
the headroom. Spike target: confirm 6-DO warm fan-out fits in 1600ms p95.

### Q6. Permission scoping (who can read what)

This is **NOT a fan-out engineering question** — it's a policy/auth question
that v0.3 must answer before fan-out can be safely implemented.

**Source of truth:** JWT props at the MCP Worker boundary. Today:
`this.props = { workspace_id, user_id }`. v0.3 must extend to:

```ts
this.props = {
  user_id: string;            // owns UserDO:{user_id}
  team_ids: string[];         // member of TeamDO:{team_id} for each
  project_ids: string[];      // role-mapped (owner|editor|viewer) per project
  org_id: string;             // org boundary
};
```

**Where membership lives.** UserDO holds the canonical list of TeamDO + ProjectDO
memberships. JWT minting walks UserDO once at session start, stamps the JWT.
JWT TTL = ~1 hour means membership changes propagate within 1 hour. v0.3 may
need a JWT-rotation hook on membership change for sensitive cases (audit
this; defer to spike).

**Fan-out scoping rule:**

```
recall(query, scope) →
  fanout_targets = [UserDO:{user_id}] ∪
                   {TeamDO:{tid} for tid in team_ids if scope ∈ ['org', null]} ∪
                   {ProjectDO:{pid} for pid in project_ids if scope ∈ ['project', null]}
```

The scoping check happens in the MCP Worker BEFORE fan-out. Each DO RPC call
ALSO validates `assertOwnsWorkspace`-style at entry (STO-07 invariant
preserved) — defense in depth.

---

## 3. What only a spike can answer

These items resist desk analysis; a real-binding spike is the only path:

| Question | Why a spike is required |
|---|---|
| Does parallel `Promise.allSettled` over 6 Vectorize namespace queries actually fit in 450ms p95? | Latency variance, throttling, cold namespace warm-up are empirical |
| Are bge-base cosine scores actually directly comparable across namespaces in practice? | Distribution-shift varies with corpus size; needs real data |
| Does the 6-connection limit serialize 12 parallel `Promise.all` cleanly, or does it queue unpredictably? | Workerd queueing semantics not documented |
| ProjectDO cold-start cost in the real fleet (warm + cold mix on user's account) | Lifecycle docs give bounds, not measurements |
| Does AI Search namespace fan-out (`instance_ids`) outperform raw Vectorize fan-out enough to justify the rewrite? | Only measurement decides |

The spike SHOULD produce a `decideGate(metric)` verdict per the
[`.planning/spikes/CONVENTIONS.md`](./spikes/CONVENTIONS.md) discipline
(spikes 001–003 set the pattern). Suggested gates:

- **GREEN:** p95 ≤ 1600ms on 6-DO warm fan-out + cross-layer F1 ≥ 0.70
- **YELLOW:** p95 ≤ 2400ms + cross-layer F1 ≥ 0.65 (acceptable but tune)
- **RED:** misses either threshold — re-design before v0.3 phase planning

---

## 4. Open decisions for v0.3 milestone questioning

These need Russell-input during `/gsd:new-milestone` for v0.3. Listed so the
milestone questioner can pull them forward verbatim:

1. **Fan-out fairness.** Should `recall(query)` weight personal > team > project
   by default, or treat all layers equally and let cosine rank?
2. **Dedup posture.** Ship v0.3 with ID-only dedup, or add content-hash column
   pre-emptively? (Recommendation: ID-only; defer content-hash to v0.4.)
3. **Cold ProjectDO policy.** Block on cold-start (predictable latency, slower
   recall) or skip + surface in `meta.gaps` (fast recall, may miss data)?
4. **AI Search rewrite.** Spike AI Search namespace fan-out as a v0.3 option,
   or commit upfront to raw Vectorize? (Recommendation: spike both, pick one.)
5. **`layer_priority` weight.** What does Russell want as the default
   personal-vs-team-vs-project preference? Tunable per-user later.

---

## 5. Action when v0.3 begins

1. Re-read this analysis as input to `/gsd:new-milestone` for v0.3.
2. Move `SEED-001-cross-layer-recall-fanout.md` from
   `.planning/seeds/` → `.planning/seeds/triggered/` (per seed action).
3. Run `/gsd:spike cross-layer-recall` against the five spike questions
   in §3. Follow `CONVENTIONS.md` — one Worker, port 8904 (next free), real
   bindings, results.html.
4. Use the spike verdict + this analysis as RESEARCH input to the first v0.3
   phase plan (likely "Phase 8: UserDO + TeamDO + ProjectDO scaffold").

---

## 6. Cross-references

- Seed source: [`SEED-001-cross-layer-recall-fanout.md`](./SEED-001-cross-layer-recall-fanout.md)
- v0.1 single-DO recall: [`packages/mcp-server/src/tools.ts`](../../packages/mcp-server/src/tools.ts) — `recall` handler
- v0.1 hybrid rank: [`packages/mcp-server/src/hybrid-rank.ts`](../../packages/mcp-server/src/hybrid-rank.ts) — base for cross-layer rerank
- v0.1 Vectorize helper: [`packages/mcp-server/src/vectorize-helper.ts`](../../packages/mcp-server/src/vectorize-helper.ts) — 64-byte namespace guard
- v0.1 STO-07 invariant: [`packages/workspace-do/src/index.ts`](../../packages/workspace-do/src/index.ts) — `assertOwnsWorkspace` defense-in-depth (preserve in v0.3)
- Spike conventions: [`.planning/spikes/CONVENTIONS.md`](../spikes/CONVENTIONS.md)
- Linear: [ENG-17](https://linear.app/blackmagicconsulting/issue/ENG-17)
