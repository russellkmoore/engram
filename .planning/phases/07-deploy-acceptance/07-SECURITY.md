---
phase: 07
slug: deploy-acceptance
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-30
verified: 2026-05-30
---

# Phase 7 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
>
> **Phase 7 character:** zero new attack surface. Phase 7 deploys existing code (Phases 1-6) to production and walks the user through OAuth bootstrap. The threat register below documents the operational + documentation surfaces; all underlying code-layer threats are owned by their original phases (especially Phase 3 OAuth + Phase 5 AI + Phase 6 queue/async).
>
> All 22 plan-time threats are CLOSED via verification during phase execution (Waves 1-3 inline verify steps + Phase 6 / Phase 3 inherited mitigations). No new auditor pass required — short-circuited per workflow rule (`threats_open: 0 AND register_authored_at_plan_time: true`).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Cloudflare control plane → Worker code | `wrangler deploy` uploads bundled Worker to Russell's account; auth via `wrangler login` browser flow OR `CLOUDFLARE_API_TOKEN` env var (operator-supplied, never committed) | bundled Worker source + wrangler.jsonc config |
| Operator shell → npm scripts | npm scripts run with operator's shell privileges; no script in Phase 7 elevates or escapes | shell command strings + script output |
| Operator shell → `scripts/kv-bootstrap.mjs` | Phase 3-vetted CLI; T-03-KV-LEAK redaction (lines 121-152) prevents identity JSON leak to process table | OAuth `sub` (key) + `{workspace_id, user_id}` JSON (value, file-passed never positional arg) |
| Russell's Mac (Claude Desktop) → deployed Worker | Claude Desktop launches `npx mcp-remote` subprocess; mcp-remote OAuth-authenticates against `engram-mcp-server.<subdomain>.workers.dev/authorize` and forwards JSON-RPC over Streamable HTTP with Bearer JWT | JSON-RPC tool calls (remember/recall/search/forget/ingest) + OAuth flow |
| OAuth `sub` claim → ENGRAM_IDENTITIES KV | Russell pastes observed `sub` into `kv:bootstrap` which writes `{workspace_id, user_id}` keyed on sub | Identity record (not a long-term secret per RESEARCH §"Known Threats Pattern 3") |
| Russell's job-search agent → Engram MCP | Forward-only capture-path swap per D-05; agent calls `remember()` through same `/mcp` endpoint with same Bearer JWT as direct Claude Desktop calls. **DEP-04 dropped from v0.1 scope — boundary documented for v0.2+ when Job Scout rewrite happens.** | Same as Russell's Mac → deployed Worker |
| Operator's keyboard → README instructions | Operator follows instructions to configure their own machine. README does NOT execute code on the operator's machine. | Plain text instructions only |
| README → packages/mcp-server/README.md (cross-link) | Down-link to a sibling README already vetted in Phase 3 | Documentation references only |

**What's NOT being added at Phase 7:**

- NO new endpoints (Phase 3-locked: `/`, `/health`, `/authorize`, `/token`, `/jwks`, `/register`, `/.well-known/*`, `/mcp`)
- NO new auth surfaces (OAuth provider + JWT validation are Phase 3-locked)
- NO new data flows
- NO new env vars or secrets
- NO new external service integrations
- NO new package installs (zero new deps; mcp-remote runs via `npx -y` on operator's machine, not as repo dep)
- NO changes to Worker code, Worker config, or runtime behavior in Plans 07-01 through 07-03

---

## Threat Register

### Plan 07-01 (npm scripts wiring)

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-07-01-DO | Denial of Service | `npm run deploy` wrapper | accept | Predeploy eval gate has finite vitest timeout; operator can Ctrl+C before any wrangler invocation. Risk is operator-time, not infrastructure. | closed |
| T-07-01-OR | Tampering | `npm run deploy` order (mcp BEFORE triage) | mitigate | Wrapper hardcodes `deploy:mcp && npm run deploy:triage` per package.json:36. README §Deploy also documents the precondition for surgical `deploy:triage` use. Verified live during deploy attempt 2 (reverse order would have errored). | closed |
| T-07-01-LEAK | Information Disclosure | `setup` completion echo | accept | Echo is plain ASCII text with no env-var interpolation, no secrets, no workspace identifiers. Verified by reading package.json:29. | closed |
| T-07-01-SC | Tampering | npm/wrangler install chain | accept | Phase 7 installs zero new packages. All referenced packages (`wrangler`, `mcp-remote`, `@modelcontextprotocol/inspector`) vetted Phase 1/3 + re-verified via slopcheck 2026-05-29 (07-RESEARCH §"Package Legitimacy Audit"). | closed |
| T-07-01-KV | Information Disclosure | kv-bootstrap discoverability line | accept | New `Discoverability:` line is a static string referencing a README section name. No KV value, no `sub`, no workspace_id interpolated. T-03-KV-LEAK redaction logic in scripts/kv-bootstrap.mjs:121-152 preserved unchanged. | closed |

### Plan 07-02 (README hoist)

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-07-02-LEAK | Information Disclosure | README OAuth bootstrap walkthrough | mitigate | All snippets use ASCII placeholders (`<some-long-string>`, `<your-subdomain>`, `<pick-an-identifier>`). No real OAuth `sub`, no real workspace_id, no real subdomain. Verified by grep during Wave 2 verify (`grep "Unknown OAuth subject" README.md` = 1 occurrence; all instances use placeholder values). | closed |
| T-07-02-SC | Tampering | `mcp-remote` supply-chain risk via README directive | mitigate | Dated rollback-marker `mcp-remote@0.1.38` + `2026-05-29` in Step 3's config snippet. Verified during Wave 2 (`grep -c "mcp-remote@0.1.38" README.md` = 1; `grep -c "2026-05-29" README.md` = 1). | closed |
| T-07-02-DUP | Repudiation / Source-of-truth drift | Multiple copies of 403 body string in README | mitigate | Literal `Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.` appears EXACTLY ONCE per D-02. Verified `grep -c "Unknown OAuth subject" README.md` = 1 (Step 4 only; NOT in Troubleshooting). | closed |
| T-07-02-WALKTHROUGH | Information Disclosure | Step 4 walkthrough on bootstrap process | accept | Walkthrough discloses HOW the bootstrap works (KV-backed identity lookup) — by design per D-01. KV value is keyed on OAuth `sub` (already known to the requester per Phase 3 T-03-PROPS); no secret material disclosed. | closed |
| T-07-02-BOOTSTRAP-DEFER | Spoofing | Deferred `kv-bootstrap-interactive` script | accept | README cross-links the v0.4 deferred work; no spoofing risk from documenting future feature. Note: ENG-11 pulls this work forward to v0.2 based on Phase 7 dogfooding signal — the cross-link target may need a date refresh. | closed |

### Plan 07-03 (HUMAN-UAT skeleton)

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-07-03-LEAK | Information Disclosure | Skeleton placeholders | mitigate | All placeholder values are `<TBD: ...>` markers — NO real OAuth `sub`, NO real workspace_id, NO real user_id, NO real account identifiers in the skeleton. Verified at Wave 3 creation time. | closed |
| T-07-03-SUB-PASTE | Information Disclosure | Operator-pasted conv excerpts during acceptance | mitigate | Skeleton's `## Operator Notes` explicitly directs Russell to use `<sub-redacted>` marker. Verified the literal "Redact OAuth" string is present in 07-HUMAN-UAT.md. **Note:** during Phase 7 acceptance, Russell populated DEP-03 Run 1 + Run 2 entries without pasting any raw `sub` values — guidance was followed. | closed |
| T-07-03-VERIFY-SHAPE | Repudiation | `/gsd:audit-uat` format compatibility | mitigate | Summary block uses literal count format (`total:`, `passed:`, `pending:`, `issues:`, `skipped:`, `blocked:` + Phase 7-specific `dropped:`) verified parseable. Frontmatter shape merged from Phase 1 analog. | closed |
| T-07-03-PREMATURE | Spoofing | `status: in_progress` vs `status: complete` | mitigate | Skeleton set `status: in_progress` at creation; flipped to `status: complete` only AFTER all tests resolved (Run 1 PASS + Run 2 PASS + DEP-04 dropped). Audit trail in git log: skeleton commit at Wave 3 → status flip commit at acceptance close. | closed |

### Plan 07-04 (deploy + acceptance)

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-07-04-SECRET | Information Disclosure | `wrangler deploy` reading Cloudflare credentials | accept | `wrangler login` browser flow OR `CLOUDFLARE_API_TOKEN` env var (operator-supplied, NEVER committed). Wrangler tooling is first-party + slopcheck `[OK]`. Phase 1 FND-08 lint validates `wrangler.jsonc` shape. | closed |
| T-07-04-SUB-LEAK | Information Disclosure | Russell pasting OAuth `sub` into `07-HUMAN-UAT.md` conv excerpts | mitigate | Skeleton's `## Operator Notes` directs `<sub-redacted>` marker. Defense-in-depth: even exposed `sub` is not a long-term secret (per RESEARCH §"Known Threats Pattern 3") — identifies dynamic mcp-remote registration, not static identity. T-07-04-LIVE-IDENTIFIER addresses sub-rotation separately. | closed |
| T-07-04-LIVE-IDENTIFIER | Information Disclosure | The actual workspace_id + user_id Russell chose (`russell-personal` + `russell`) via `kv:bootstrap` | accept | Russell picked arbitrary identifier strings. These become permanent claims in every JWT. Impact bounded by STO-07 defense-in-depth (only THIS workspace's data accessible) and v0.1 single-user single-account scope. v0.3 introduces multi-workspace; rotation pattern lands then. | closed |
| T-07-04-SC | Tampering | `mcp-remote` supply-chain risk via `npx -y` on Russell's machine | mitigate | `mcp-remote@0.1.38` slopcheck `[OK]` verified 07-RESEARCH §"Package Legitimacy Audit" (2026-05-29). Dated rollback marker in README §Step 3 anchors the working version. | closed |
| T-07-04-DEPLOY-ORDER | Tampering | Cross-worker DO binding deploy order | mitigate | `npm run deploy` wrapper from Plan 01 enforces mcp-server BEFORE triage-worker. Verified live during deploy attempt 3 (succeeded in chained order). README Troubleshooting also documents the symptom + fix. | closed |
| T-07-04-WORKSPACE-CONFUSION | Spoofing | DEP-03 Run 1 vs Run 2 workspace cross-contamination | accept | Both runs use the same `workspace_id` (Russell's single workspace per D-05). STO-07 defense-in-depth check ensures any DO call validates `state.id.name === args.workspace_id`. AI-02 Vectorize namespace isolation unit-tested in Phase 5. Both runs returned correct content with no cross-contamination per HUMAN-UAT entries. | closed |
| T-07-04-CLAUDE-DESKTOP-CACHE | Information Disclosure | Stale `~/.mcp-auth/` JWT after re-bootstrap | mitigate | README Troubleshooting documents `rm -rf ~/.mcp-auth/` as the workaround. Did NOT need to apply during Phase 7 — bootstrap succeeded on first complete attempt post-KV-write. | closed |
| T-07-04-AGENT-REWIRE-LEAK | Information Disclosure | Job-search agent's pre-Engram local files | accept | Per D-05, pre-Engram local files stay UNTOUCHED on disk as historical record. **DEP-04 dropped from v0.1 scope** during execution — no Engram-side rewire performed; threat surface intentionally not exercised in this phase. Future Job Scout rewrite (separate codebase) will exercise the same MCP tools already proven via DEP-03. | closed |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-07-01 | T-07-01-DO | Predeploy eval gate has finite vitest timeout; operator can Ctrl+C before any wrangler invocation. Risk is operator-time, not infrastructure. | russell | 2026-05-30 |
| AR-07-02 | T-07-01-LEAK | Setup completion echo is plain ASCII text with no env-var interpolation. | russell | 2026-05-30 |
| AR-07-03 | T-07-01-SC | Phase 7 installs zero new packages. All referenced packages vetted via slopcheck 2026-05-29. | russell | 2026-05-30 |
| AR-07-04 | T-07-01-KV | Discoverability line is static string referencing a README section. No KV value interpolated. | russell | 2026-05-30 |
| AR-07-05 | T-07-02-WALKTHROUGH | KV-backed identity lookup is intentionally documented (transparent bootstrap per D-01). KV key is the OAuth `sub` already known to the requester. | russell | 2026-05-30 |
| AR-07-06 | T-07-02-BOOTSTRAP-DEFER | Documenting v0.4 (now v0.2 per ENG-11) deferred feature carries no spoofing risk. | russell | 2026-05-30 |
| AR-07-07 | T-07-04-SECRET | Cloudflare credentials are operator-supplied + never committed. Wrangler is first-party tooling. | russell | 2026-05-30 |
| AR-07-08 | T-07-04-LIVE-IDENTIFIER | Russell's workspace_id (`russell-personal`) + user_id (`russell`) are permanent claims in JWTs. v0.1 single-user single-account scope; v0.3 multi-workspace introduces rotation. | russell | 2026-05-30 |
| AR-07-09 | T-07-04-WORKSPACE-CONFUSION | DEP-03 both runs use same workspace_id. STO-07 + AI-02 namespace isolation provide defense-in-depth. Both runs returned correct content. | russell | 2026-05-30 |
| AR-07-10 | T-07-04-AGENT-REWIRE-LEAK | DEP-04 dropped from v0.1 scope — pre-Engram local files untouched. Job Scout rewrite (separate codebase, future) will exercise proven MCP tools. | russell | 2026-05-30 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-30 | 22 | 22 | 0 | claude (verify-phase short-circuit per workflow `register_authored_at_plan_time: true AND threats_open: 0` rule) |

**Audit notes (2026-05-30):**

- All 22 threats authored at plan-time across Plans 07-01..07-04
- 12 dispositions = `mitigate`: mitigations verified during phase execution via Waves 1-3 inline grep/file-inspect verify steps
- 10 dispositions = `accept`: documented in Accepted Risks Log above (AR-07-01..AR-07-10)
- 0 dispositions = `transfer`
- DEP-04 dropped from v0.1 scope mid-execution: T-07-04-AGENT-REWIRE-LEAK acceptance rationale updated to reflect non-exercise
- Phase 7's character ("zero new attack surface — deploys existing code") supports the short-circuit verification path; no auditor subagent spawn required
- Inherited mitigations from Phase 3 (OAuth + KV identity lookup), Phase 5 (AI + Vectorize), Phase 6 (Queue + STO-07) are owned by their original SECURITY.md (Phase 6) or pending audits (Phases 3, 5 — see /gsd:secure-phase backlog)

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (AR-07-01..AR-07-10)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-30
