---
id: SEED-002-DESIGN
parent_seed: SEED-002
status: draft
authored: 2026-05-31
authored_by: ENG-8 backlog sweep (Claude, autonomous)
trigger_status: still dormant — cost/throughput model pre-positioned for v0.4 milestone planning
informs: v0.4 — Connectors + Alerts (target 2026-08-02), v1.0 managed pricing decision
linear: ENG-18
---

# SEED-002 design analysis — Connector cost + throughput model

> **Purpose.** Build the load + cost model SEED-002 asks for, BEFORE v0.4
> connector phases are planned. Outputs a per-active-workspace cost curve, a
> per-DO throughput ceiling, and the binding constraint that will decide
> whether the managed pricing tier survives a chatty Slack channel.
>
> **Out of scope.** No code is written. Final pricing tier decision is
> Russell's; this analysis surfaces the numbers + the cliff. Final v0.4
> connector architecture decisions are deferred to `/gsd:plan-phase` for v0.4
> phase 1; this analysis is the cost-model input.

---

## 0. Engram's per-memory AI workload (the multiplier)

Phase 5 locked the Triage Worker pipeline. Per memory:

| Step | Model | Input tokens (avg) | Output tokens (avg) | Cost basis |
|---|---|---:|---:|---|
| 1. Classifier + extractor | `@cf/meta/llama-3.1-8b-instruct` | ~600 (memory + prompt) | ~200 (JSON) | Text Generation tier |
| 2. Embedding | `@cf/baai/bge-base-en-v1.5` (768d) | ~512 per chunk | (vector only) | Text Embeddings tier |

For a typical Slack message (~200 chars = ~50 tokens), the chunker produces
**1 chunk**, so 1 classifier call + 1 embedding call = **2 AI calls/message**.
For a 1,500-char Drive doc (~400 tokens), 1 chunk still suffices, same 2 calls.
For a long doc (>2,000 tokens), 2–4 chunks → 1 classifier + 2–4 embeddings =
**3–5 AI calls**.

**v0.4 baseline assumption:** 2.5 AI calls per ingested item (weighted avg
across Slack + Drive).

> Memorability scoring is folded into the classifier prompt (Phase 5 D-02),
> not a separate call. Conflict detection is async per-write batched (Phase 6
> D-01 deferred conflict to v0.2; v0.4 inherits the deferred posture — no
> per-write conflict-scan AI call in the model).

---

## 1. Current Cloudflare pricing (2026-05-31, paid plan only)

Sourced from CF docs via the developer-platform MCP. Lock these numbers in
the v0.4 milestone questioning so the model is reproducible.

### 1.1 Workers AI

| Item | Rate |
|---|---|
| Subscription | Bundled with Workers Paid ($5/mo) |
| Per-model billing | $0.011 per 1,000 Neurons (~ $11 per 1M Neurons) |
| **Classifier** (`@cf/meta/llama-3.1-8b-instruct`) | **$0.28/M input tokens, $0.83/M output tokens** |
| **Embedding** (`@cf/baai/bge-base-en-v1.5`) | $0.014/M input tokens (per docs index) |
| Free allocation | 10K Neurons/day (resets 00:00 UTC) |

### 1.2 Workers AI rate limits (per ACCOUNT, not per workspace)

| Task | Limit |
|---|---|
| **Text Generation (classifier)** | **300 req/min** = 18K/hour = 432K/day |
| Text Embeddings | 3000 req/min = 180K/hour = 4.32M/day |
| Summarization | 1500 req/min |

**The text-generation 300 req/min cap is THE binding constraint** for
connector load at the managed multi-tenant tier. See §4.

### 1.3 Vectorize

| Item | Rate |
|---|---|
| Queried dimensions | First **50M/month** included, then **$0.01/M** |
| Stored dimensions | First **10M/month** included, then **$0.05/100M** |
| Index capacity | 10M vectors per index (was 5M, raised 2026-01-23) |
| bge-base dimensions | 768 |

Formula: `((queried + stored) * dims * 0.01/1M) + (stored * dims * 0.05/100M)`

### 1.4 Queues

| Item | Rate |
|---|---|
| Standard operations | 1M/month included, then **$0.40/M** |
| Ops per message delivery | **3** (write + read + delete) |
| Free | 10K ops/day |

### 1.5 Durable Objects

| Item | Rate |
|---|---|
| Requests | 1M/month included, then **$0.15/M** (RPC = 1 req/call) |
| Duration | 400K GB-s/month included, then **$12.50/M GB-s** |
| Hibernation | Free (idle DOs don't bill duration once hibernated) |

### 1.6 Workers (envelope)

| Item | Rate |
|---|---|
| Subscription | **$5.00/mo** (always-on floor) |
| Standard | 10M req/month included, $0.30/M after |
| CPU | 30M CPU-ms/month included, $0.02/M ms after |

---

## 2. The model — cost per workspace per month, parametrized

### 2.1 Per-message cost decomposition

For a typical Slack message (~50 tokens):

| Component | Calc per msg | Cost per msg |
|---|---|---:|
| Classifier (llama-3.1-8b) | 600 in × $0.28/M + 200 out × $0.83/M | $0.000334 |
| Embedding (bge-base) | 512 in × $0.014/M | $0.0000072 |
| Vectorize stored | 768 dims × $0.05/100M (one-time) | ~$0.00000038 |
| Vectorize queried (on recall, ~10% rate) | 768 × $0.01/M × 0.1 | $0.00000077 |
| Queue (3 ops × $0.40/M) | | $0.0000012 |
| DO RPC (3 calls: insertBlock + updateEnrichment + index touch) | 3 × $0.15/M | $0.00000045 |
| DO duration (~50ms × 128MB GB-s) | 0.05 × 0.128 × $12.50/M | $0.00000008 |
| **Per-message total** | | **~$0.000337** |

Rounded: **$0.00034 / message**. Dominated by the classifier (99% of cost).

### 2.2 Cost per workspace per month at varying ingest rates

Includes per-message + amortized $5/mo Workers subscription / N active
workspaces. Subscription cost depends on tenant count — model assumes 100
active managed-tier workspaces sharing the $5 floor = $0.05/workspace/mo
subscription overhead.

| Ingest rate (msg/hour) | Msg/month (24×30 days) | Per-msg cost | Per-ws subscription | **Total/ws/mo** |
|---:|---:|---:|---:|---:|
| 1 | 720 | $0.245 | $0.05 | **$0.30** |
| 10 | 7,200 | $2.45 | $0.05 | **$2.50** |
| 100 | 72,000 | $24.48 | $0.05 | **$24.53** |
| 1,000 | 720,000 | $244.80 | $0.05 | **$244.85** |

**Reading the curve:**

- **A $5/mo tier survives 10–20 msg/hour cleanly.** Light personal usage,
  occasional Slack capture, light Drive polling. Healthy margin.
- **A $20/mo tier survives ~75 msg/hour.** A moderately active personal
  Slack workspace. Tight margin — one chatty week blows the unit economics.
- **At 100 msg/hour, unit cost is $24.53/ws/mo.** Any tier under $30
  loses money. This is the cliff SEED-002 warned about.
- **At 1,000 msg/hour, the per-workspace cost rivals enterprise SaaS
  contracts.** Not a v1.0 tier; needs a custom-priced enterprise plan.

### 2.3 Storage cost (separate dimension)

For 1,000 stored memories per workspace × 768 dims:
- Stored dims = 768K → $0.000384/mo (well within 10M free)

100K stored memories per workspace = 76.8M stored dims → **$3.84/mo per
heavy-storage workspace**. Material at v1.0 scale; trivial at v0.4 pilot.

---

## 3. Throughput model — per-workspace DO ceiling

A single `WorkspaceDO` serializes all writes (single-threaded, soft
1,000 req/sec). Per Slack message, the write path is:

1. MCP-side `remember()` → 1 RPC to WorkspaceDO (insertBlock)
2. Triage queue producer → no DO touch
3. Triage consumer → 1 RPC (updateBlockEnrichment) OR 1 RPC (moveToInbox)
   OR 1 RPC (moveToColdStorage)
4. Vectorize upsert → no DO touch
5. (Future: relation graph touch from `relate` → 1 RPC, not in v0.4 baseline)

**Per memory = 2 DO RPC calls** in the v0.4 baseline.

At 1,000 msg/sec inbound, that's 2,000 DO RPCs/sec → **2× the soft
single-DO cap**. The cap is reached at ~500 msg/sec sustained, which is
~30K msg/min, far above any reasonable single-workspace Slack rate.

**Posture:** single-DO serialization is fine for v0.4. Sharded triage is
unnecessary at this scale. **DO single-threading is not the cliff.**

---

## 4. The real cliff — Workers AI text-generation 300 req/min cap

Workers AI text-generation is rate-limited **per account, not per
workspace**: 300 req/min = 18K/hour = 432K/day = ~13M/month.

### 4.1 What this means for managed multi-tenancy

At 2.5 AI calls/memory and 60% of those being classifier (text gen):
**1.5 classifier calls per memory**.

Account-level classifier ceiling:
- 300 req/min ÷ 1.5 calls/msg = **200 msg/min ingest ceiling per account**
- 12K msg/hour per account
- 288K msg/day per account

**Multi-tenant implications (managed cloud running on ONE Cloudflare
account):**

| Active managed workspaces | Per-ws ceiling (msg/hour) | Feels like |
|---:|---:|---|
| 10 | 1,200 | Comfortable, even chatty users fit |
| 100 | 120 | Borderline — busy workspaces saturate before others get fair share |
| 1,000 | 12 | **Cliff** — most users feel rate-limited |

**Implication:** The managed tier CANNOT run 1,000 active workspaces on a
single Cloudflare account. v1.0 must either (a) shard managed customers
across multiple Cloudflare accounts, (b) request a custom Workers AI rate
limit increase (the docs page has a Custom Requirements Form), or (c) keep
managed scale capped + offer self-hosted as the relief valve.

### 4.2 What this means for SELF-HOSTED

Self-hosted = one Cloudflare account per user. The 432K msg/day ceiling is
**per-user**, which translates to ~5/sec sustained — far above any single
user's connector firehose. **Self-hosted is unaffected.** The cliff is
exclusively a managed-tier scaling problem.

---

## 5. Queue depth growth — backpressure tolerance

`engram-ingest` queue retention:
- **Workers Free:** 24 hours (non-configurable)
- **Workers Paid:** 4 days default, configurable to 14 days

At 12K msg/hour cap (managed-tier ceiling), if the Triage consumer hangs
for 1 hour, **queue backlog = 12K msgs**. At 4-day retention, the queue can
absorb up to 4×24×12K = ~1.15M messages of backlog before retention
expires.

Queue ops cost during backpressure: 1.15M msgs × 3 ops × $0.40/M = **~$1.38**
in absolute worst case. Trivial. **Queue retention is not a binding cost
constraint.**

---

## 6. Decision gates (per SEED-002)

The seed defined three explicit decision gates. Verdict from this model:

| Gate | Verdict |
|---|---|
| **If $20/mo can't cover a 100 msg/hour channel → managed pricing model needs rethink BEFORE v1.0 launch** | **🔴 TRIGGERED.** $20/mo covers ~75 msg/hour. A sustained 100 msg/hour channel costs ~$25/mo, which is above the $20 tier ceiling. Pricing model needs adjustment OR sampling/debouncing mitigations enabled by default. |
| **If a single DO serializes through a 50 msg/sec burst safely → ship as designed** | **🟢 OK.** Single-DO writes peak at ~500 msg/sec before hitting the soft cap. 50 msg/sec is 10% of capacity. v0.4 ships single-DO writes. |
| **If a single DO chokes → introduce a per-channel fan-out worker** | **N/A.** DO does not choke. Defer fan-out worker indefinitely. |

**Discovered fourth cliff** (not in the original seed, but the model
surfaces it):

| Gate | Verdict |
|---|---|
| **Account-level Workers AI text-generation 300 req/min cap is the real ceiling for managed multi-tenancy** | **🟡 ARCHITECTURAL — v1.0 pricing depends on this.** At 100 active managed-tier workspaces, per-workspace ceiling drops to 120 msg/hour. At 1,000, to 12 msg/hour. v1.0 must either shard across accounts, request a custom rate limit, or cap managed scale. |

---

## 7. Mitigations the model justifies (in priority order)

Pulled from SEED-002's mitigation list with this model's evidence backing
each. Apply IF the v0.4 milestone questioning confirms managed-tier scale
matters; for v0.4 pilot (Russell + a few invitees), most are unnecessary.

### Tier 1 — required IF managed tier targets >100 workspaces

1. **Memorability lexical pre-filter at the edge.** Before any Workers AI
   call, run a cheap lexical heuristic (keyword presence, length, message
   pattern). Drop ~50% of low-value Slack noise before it costs a classifier
   call. Halves the classifier rate, doubles managed workspace ceiling.
2. **Sampling / debouncing for Slack.** Coalesce per-thread; ingest the
   thread summary (1 classifier call) instead of every message (10–20
   classifier calls per thread). Reduces classifier rate 5–10× for chatty
   channels.

### Tier 2 — optional ergonomics, smaller wins

3. **Batched embedding.** bge-base supports batched input (`text: string[]`).
   Reduces request count for embedding tier, but embedding is NOT the
   binding constraint (3000 req/min ceiling, plenty of headroom).
4. **Cold-storage default for connector ingest.** Connector-sourced
   memories default to cold-storage unless `memorability > 0.6`. Already
   roughly the existing posture (Phase 5 D-07); v0.4 just needs to
   confirm the threshold is right for connector traffic.

### Tier 3 — architectural (defer unless cliff is hit)

5. **Sharded triage.** Multiple triage workers behind the queue, ordered
   per workspace_id. Adds complexity; only justified if a single triage
   consumer hits CPU limits, which the model says it won't at v0.4 scale.

---

## 8. Open decisions for v0.4 milestone questioning

These need Russell-input during `/gsd:new-milestone` for v0.4 (or a
pricing-tier discussion sooner). Listed verbatim for the questioner:

1. **Managed pricing tier target.** Is "$5–20/mo" still the goal? The model
   shows $20/mo only covers light personal usage (~75 msg/hour) without
   sampling. Either raise prices, default-on sampling, or cap usage per tier.
2. **v0.4 default sampling posture.** Should Slack/Drive ingest default to
   "ingest everything" (true to the seed's claim about memorability) or
   "sample/debounce by default, opt-out for paranoid users"? Affects per-ws
   cost by ~10×.
3. **Multi-tenancy strategy.** Single CF account for all managed users
   (cliff at ~100 workspaces), shard across N accounts (operational
   complexity), or request a custom Workers AI rate limit (process unknown
   — needs CF sales conversation)?
4. **Conflict detection in v0.4.** Phase 6 D-01 deferred per-write conflict
   detection to v0.2. v0.2 has shipped; does v0.4 want connector-volume
   conflict detection on, or stay batched/async? Cost impact: +1 AI call
   per memory if synchronous → halves managed ceiling further.
5. **Self-hosted vs managed marketing.** If managed has a real ceiling at
   ~100 active accounts, is self-hosted the v1.0 lead with managed as
   "convenience pricing" for users <50 msg/hour? Affects landing-page
   positioning more than engineering.

---

## 9. Action when v0.4 begins

1. Re-read this analysis as input to `/gsd:new-milestone` for v0.4.
2. Move `SEED-002-connector-cost-throughput-model.md` from
   `.planning/seeds/` → `.planning/seeds/triggered/` (per seed action).
3. Resolve the 5 open decisions in §8 during v0.4 questioning — they shape
   the entire v0.4 architecture.
4. If §6 gate 1 (managed pricing) stays triggered after the questioning,
   add the Tier 1 mitigations (lexical pre-filter, sampling) as v0.4 phase
   1 — they're cheap engineering vs. either re-pricing or capping users.
5. If §6 gate 4 (multi-tenant ceiling) matters at v1.0 timeline, file a
   separate Linear issue for "Custom Workers AI rate limit request" — it's
   a CF sales conversation that has lead time.

---

## 10. Cross-references

- Seed source: [`SEED-002-connector-cost-throughput-model.md`](./SEED-002-connector-cost-throughput-model.md)
- Triage Worker pipeline (Phase 5 + Phase 6): [`packages/triage-worker/src/index.ts`](../../packages/triage-worker/src/index.ts)
- Memorability classifier prompt: [`packages/triage-worker/src/prompts.ts`](../../packages/triage-worker/src/prompts.ts)
- Cold-storage routing (D-07): [`packages/triage-worker/src/index.ts`](../../packages/triage-worker/src/index.ts) — `routeByMemorability`
- Connector interface spec: [`CLAUDE.md`](../../CLAUDE.md) § Connector Interface
- Linear: [ENG-18](https://linear.app/blackmagicconsulting/issue/ENG-18)

---

## 11. Numbers locked at authoring (re-verify at trigger time)

CF pricing pages update. Confirm these numbers still hold when v0.4 starts:

- llama-3.1-8b-instruct: $0.28 in / $0.83 out per M tokens ← LIKELY TO CHANGE
- Workers AI text-generation rate: 300 req/min ← stable historically
- bge-base-en-v1.5: $0.014/M input tokens ← LIKELY TO CHANGE
- Vectorize: $0.01/M queried dims, $0.05/100M stored ← stable historically
- Queues: $0.40/M ops (3 ops/msg) ← stable
- DOs: $0.15/M requests, $12.50/M GB-s ← stable
- Workers subscription: $5/mo ← stable

If any of these has changed by ≥20% at trigger time, re-run §2.1 + §2.2
calculations before applying mitigations.
