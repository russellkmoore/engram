---
id: SEED-002
status: dormant
planted: 2026-05-26
planted_during: Phase 3 (MCP Server Scaffold) — v0.1
trigger_when: v0.4 — Connectors + Alerts (BEFORE any connector phase is planned)
scope: small
---

# SEED-002: Model connector load + cost + throughput BEFORE v0.4 connectors ship

## Why This Matters

"Scales to zero" is an idle-state claim. v0.4 connectors (Slack streaming, Drive scheduled polling) introduce a fundamentally different load profile: a chatty Slack channel fans EVERY message into multiple Workers AI calls — extract entities + summarize + embed per chunk + score memorability + scan for conflicts — and writes through a single per-workspace DO that serializes all writes.

The cost shape changes from "Russell types occasionally in Claude Desktop" to "100 messages/hour × 5 AI calls × N connected workspaces" on the $5–$20/month managed tier. The throughput shape changes from "one writer per workspace" (fine) to "Slack firehose serialized through a single DO" (potentially fine, potentially not — DO request limits + Workers AI rate limits both apply).

If the math doesn't work, you discover it in production after onboarding the first paying user. That's the worst possible time to discover it. A spreadsheet model takes 1 hour and prevents this.

## When to Surface

**Trigger:** Run BEFORE the first phase of v0.4 — Connectors + Alerts is planned. Specifically: before `/gsd:plan-phase` for any phase that creates `connector-slack`, `connector-drive`, or extends `triage-worker` to handle connector volumes.

This seed will surface during `/gsd:new-milestone` when v0.4 scope is being defined.

## Scope Estimate

**Small** — A spreadsheet exercise + a written findings doc + a `/gsd:add-todo` for any mitigations needed. Roughly 1 hour for the model, possibly 1 day if mitigations require schema or architecture changes (batching, debouncing, sampling).

## What the Model Needs to Cover

Build a load model with these inputs (and stress-test each):

**Inputs:**
- Average Slack channel volume (msg/hour) for a typical engineering team — assume 50–500
- Average message length (~200 chars for chat; the chunker may produce 1–3 chunks per message)
- Workers AI per-chunk cost: extract + summarize + embed = ~3 AI calls per chunk
- Memorability + conflict scan: 1–2 additional AI calls per memory
- Cloudflare Workers AI pricing tier in effect (Free / Workers Paid)
- Cloudflare Vectorize storage + query pricing
- DO request count + duration billing
- Queue message + consumer duration billing

**Outputs to compute:**
1. **Cost per active workspace per month** at: 1 msg/hour, 10 msg/hour, 100 msg/hour, 1000 msg/hour ingest rates
2. **DO request rate per workspace at peak** — does a single Slack channel saturate one WorkspaceDO's single-writer model? At what msg/sec?
3. **Workers AI rate limit ceiling** — at what ingest rate do we start hitting 429s and needing aggressive `message.retry({delaySeconds: ...})`?
4. **Queue depth growth** — if the triage worker can't keep up, how long until the `engram-ingest` queue backs up to a problematic depth?
5. **Pricing tier viability:** does $5/mo, $10/mo, $20/mo each survive a heavy Slack channel? Where's the cliff?

**Decision gates from the model:**
- If $20/mo can't cover a 100 msg/hour channel → managed pricing model needs rethink BEFORE v1.0 launch
- If a single DO serializes through a 50 msg/sec burst safely → ship as designed
- If a single DO chokes → introduce a per-channel fan-out worker between connector and DO

## Mitigations to Consider If Model Shows Problems

- **Sampling / debouncing:** Don't ingest every Slack message. Coalesce per-thread, ingest the thread summary instead of every message.
- **Memorability filter at the edge:** Run a cheap lexical pre-filter before the Workers AI memorability scorer.
- **Batched embedding:** Embed N chunks per Workers AI call instead of one-per-call.
- **Sharded triage:** Multiple triage workers behind the queue; ordered consumption per workspace_id only.
- **Cold-storage by default for connector ingest:** Connector-sourced memories default to cold-storage unless `memorability > 0.6`, surfaced via inbox.

## Breadcrumbs

- `CLAUDE.md` §"Connector Interface" — current spec
- `CLAUDE.md` §"What Is Engram" §"Open core business model" — "$5–20/mo" managed tier target
- `.planning/REQUIREMENTS.md` — v0.4 milestone "v0.4 Connectors + Alerts" target 2026-08-02
- Phase 5 design (when it lands) sets the Workers AI call count per memory — this is the multiplier in the load model
- Cloudflare Workers AI pricing page (current rates) — pull when running the model

## Notes

Captured 2026-05-26 from architectural critique. The critique flagged: "Cost/throughput under connector load. 'Scales to zero' is an idle-state claim. A chatty Slack channel (v0.4) fans every message into multiple Workers AI calls (extract + summarize + embed per chunk, score, conflict-scan). The $5–20/mo tier may not survive that, and a single DO is a serialization point for a busy workspace. Model this before v0.4, not during."
