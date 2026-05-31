---
id: ENG-11-DESIGN
parent_issue: ENG-11
status: draft
authored: 2026-05-31
authored_by: ENG-8 backlog sweep (Claude, autonomous)
informs: v0.2 — Intelligence Layer (target 2026-06-21) phase planning
proposal_type: pulled-forward feature design (from v0.4 deferral)
---

# ENG-11 design analysis — Better first-run auth flow

> **Purpose.** Russell's Phase 7 dogfooding established that the 8-step manual
> bootstrap dance bites real users (~60-90 min of friction). The original
> CONTEXT.md D-01 decision deferred the better experience to v0.4 on the
> assumption "we don't have signal yet on whether the friction actually bites";
> dogfooding produced the signal, deferral is wrong.
>
> This document scopes the v0.2 phase that ships the better experience. It
> compares the two implementation options the issue proposes, walks through
> security/UX/scope tradeoffs, and recommends a path so v0.2 milestone
> planning can pull this into a concrete phase.
>
> **Out of scope.** Implementation. v0.2 phase planning + execution lives in
> the regular GSD workflow.

---

## 0. The current 8-step dance (baseline)

For reference, this is what the issue documents as the v0.1 first-run flow:

1. Edit `claude_desktop_config.json` manually (risk: wipes other MCP servers)
2. Restart Claude Desktop
3. Trigger any MCP tool call to see `403: Unknown OAuth subject: <sub>`
4. Copy the `sub` from the error
5. Run `npm run kv:bootstrap -- --sub <sub> --workspace-id <id> --user-id <id>`
   - ENG-7 (CWD bug) is now fixed; this no longer adds an extra step
6. Wait for KV propagation (eventual consistency — first retry often fails)
7. Restart Claude Desktop again
8. Try the tool call once more

**Friction points Russell hit in Phase 7:**

- Step 1 wiped his Context7 + Invest Collective MCP entries
- Step 5's CWD bug confused him (now fixed via ENG-7)
- Step 6's propagation lag made him think Step 5 failed
- Step 7 added a second Claude Desktop restart

**Target after v0.2 fix:** ≤5 manual steps, zero terminal-edit-config, zero
"Unknown OAuth subject" error visibility.

---

## 1. Option A — Standalone interactive script

**Shape.** `npm run kv:bootstrap-interactive` runs entirely from terminal.
The script:

1. Detects or prompts for the deployed mcp-server URL (falls back to
   `wrangler whoami` + `wrangler deployments list` to suggest)
2. Launches a local OAuth callback server on a free port (`http://localhost:<port>/cb`)
3. Opens the user's browser to the Worker's `/authorize?…&redirect_uri=http://localhost:<port>/cb`
4. User completes OAuth in browser (Claude Desktop's exact flow, but in user's main browser)
5. Callback server captures the authorization code → exchanges it for a JWT
   at `/token` → decodes the JWT to extract `sub`
6. Prompts for `workspace_id` + `user_id` (with sensible defaults that the
   user can accept by pressing Enter)
7. Invokes the existing `kv:bootstrap` flow with the captured sub
8. Polls KV until propagation completes (5-15s typically)
9. Prints "Bootstrap complete. Restart Claude Desktop once and you're ready."

**Pros:**

- ✅ Uses the existing `kv:bootstrap` security model (T-03-KV-LEAK posture
  preserved — never echoes identity JSON)
- ✅ No new HTTP endpoint, no new attack surface on the Worker
- ✅ Eliminates Steps 3-4 (the error-then-read-sub dance)
- ✅ Resolves Step 6 (propagation lag) by polling
- ✅ Inherits all existing OAuth security (PKCE, state validation)
- ✅ Works offline-ish — no requirement to visit a Worker URL in a browser
  for setup-specific reasons (the OAuth flow itself does need internet)

**Cons:**

- ❌ Still requires terminal + Node + wrangler installed (Engram dev
  audience: fine; future managed-tier customer audience: not fine)
- ❌ Still requires manual edit of `claude_desktop_config.json` for Step 1
  (the MCP server URL) — the script can PRINT the right snippet for the user
  to copy, but can't safely edit JSON config files cross-platform
- ❌ Adds ~200 lines of OAuth callback handling (small but new code surface)

**Manual step count after Option A:**

1. (Unchanged) Run a one-liner to add Engram to `claude_desktop_config.json`
   — script generates the snippet, user pastes
2. (Unchanged) Restart Claude Desktop
3. (NEW) Run `npm run kv:bootstrap-interactive` — script does the rest

**3 steps total.** Hits the ≤5 acceptance bar.

---

## 2. Option B — `/bootstrap` HTTP endpoint on the deployed Worker

**Shape.** The Worker exposes a one-time setup page at
`https://<deployed-worker>/bootstrap?setup_token=<one-time>`. The user:

1. Deploys the Worker (existing `npm run deploy`)
2. Adds Engram to `claude_desktop_config.json` (snippet from README)
3. Restarts Claude Desktop, triggers first tool call → 403 with a link:
   "Engram needs first-run setup. Visit: https://<worker>/bootstrap?token=<setup-token>"
4. User clicks the link → form: workspace_id + user_id (or accept defaults)
5. User submits → Worker writes KV entry server-side → propagation is
   instant from Worker's perspective → success page
6. Re-trigger any tool call → works

**Pros:**

- ✅ Browser-only UX after step 1 — no terminal needed for setup
- ✅ Solves the propagation lag fundamentally (Worker reads its own KV after
  the put, KV propagation within the same colo is faster than cross-colo)
- ✅ Forward-compatible with managed-tier (where users don't have CLI access)
- ✅ Closer to how every other SaaS does first-run setup

**Cons:**

- ❌ **NEW ATTACK SURFACE.** Anyone visiting the URL during the setup
  window could create identity records and reach `workspace_id` data.
  Mitigations needed (see §2.1).
- ❌ Requires a UI on the Worker (React? Plain HTML?) — design + a11y +
  responsiveness — meaningful scope creep
- ❌ Bootstrap-by-URL means the URL has to be discoverable. The "403 with
  setup link" hand-off is opaque if the user has multiple MCP errors
- ❌ One-time setup tokens add a state-tracking concern (where do they
  live? KV with TTL? Coupled to deployment lifecycle?)
- ❌ The `setup_token` URL has to be communicated to the user somehow.
  Options: printed by `wrangler deploy`, written to local file, captured
  from deployment metadata — each adds glue.

### 2.1 Security mitigations required for Option B

The threat is "someone visits `/bootstrap` and writes themselves into KV
as the workspace owner." Mitigations to evaluate at phase plan time:

| Mitigation | Effectiveness | Cost |
|---|---|---|
| Setup token in URL (single-use, TTL=10min) | High — random 256-bit nonce | Low — KV write + TTL |
| Only allow when ENGRAM_IDENTITIES KV has zero records | High — closes endpoint after first use | Low — `KV.list({limit:1})` check |
| Require setup token AND empty KV | Belt + suspenders | Low |
| Rate limit | Moderate — limits brute force | Built-in via Cloudflare |
| Require IP allowlist (loopback or operator IP) | High but operationally annoying | Low — header check |

**Recommended:** "setup token + empty KV" both required. Closes the endpoint
permanently after first use AND requires possession of the token.

---

## 3. Option C — Hybrid (recommended)

Neither option alone is right for v0.2. **Recommended posture:**

1. **Ship Option A first as the v0.2 phase scope.** Solves Russell's
   immediate pain. Reuses existing security model. Forward-compatible with
   later additions.
2. **Defer Option B to v1.0 launch (managed cloud).** The HTTP endpoint
   is the right UX for managed customers (browser-only), but the security
   surface deserves real review BEFORE the first paying user — not in the
   middle of v0.2 dev work where the focus is intelligence-layer features.
3. **Improve `claude_desktop_config.json` editing as a separate concern.**
   Out of scope for v0.2. Could ship in v0.3 as part of broader "Engram CLI"
   work, or just stay manual with great docs.

---

## 4. Scope estimate for v0.2 phase

If v0.2 milestone planning accepts Option A:

| Task | Estimate | Notes |
|---|---|---|
| 1. Local OAuth callback server (Node ESM) | 0.5 day | `http.createServer`, free-port discovery |
| 2. JWT decoder for `sub` extraction (no validation needed — server validates) | 0.25 day | Plain base64url + JSON |
| 3. Interactive prompts (workspace/user IDs with defaults) | 0.25 day | `readline.createInterface` |
| 4. Wire to existing `kv:bootstrap` (spawn or import) | 0.25 day | Reuse not rewrite |
| 5. KV propagation poll loop (read-only on KV via wrangler) | 0.5 day | Bounded retry + clear UX |
| 6. README + CONTRIBUTING.md updates | 0.25 day | Document the new flow |
| 7. Manual test on a fresh clone (acceptance gate) | 0.5 day | Russell-on-Devon scenario |
| **Total** | **~2.5 days** | Single contributor, single phase |

This fits comfortably as one v0.2 phase among the intelligence-layer phases.

### 4.1 Dependencies

- ENG-7 (kv:bootstrap CWD bug) — **already landed** (commit 6b969a9)
- v0.2 milestone planning needs to accept the scope addition
- Worker `/authorize` endpoint needs to support `redirect_uri=http://localhost:*`
  with PKCE — verify v0.1 implementation already does (Phase 7 OAuth code review
  said yes; double-check during phase plan)

### 4.2 Acceptance gate

A fresh user (e.g., Devon) goes from `git clone` → working Engram in Claude
Desktop in **≤5 manual steps** with **zero terminal-edit-config** and **zero
"Unknown OAuth subject" error visibility**.

Concrete script-based test: clone the repo to a fresh `/tmp/eng-test` dir,
deploy, run `npm run kv:bootstrap-interactive`, complete OAuth in browser,
trigger Engram tool in Claude Desktop, observe success. Pass = ≤5 manual
steps + no terminal config-file edits.

---

## 5. Why pull forward to v0.2 (not v0.4)

The original deferral was "we don't have signal yet." Russell's verdict
after Phase 7 deploy: "I do want a better auth flow sooner. Seeding the KV
was not straightforward." Signal acquired.

v0.4 = Connectors + Alerts (target 2026-08-02). Pulling auth UX to v0.4
would mean:
- v0.2 + v0.3 contributors fight the 8-step dance every time they reset
- v0.3 multi-workspace work compounds the friction (more identities, more KV writes)
- v0.4 phase budget squeezed (already has Slack + Drive scope)

v0.2 = Intelligence Layer (target 2026-06-21). Pulling auth UX to v0.2
means:
- v0.3 + v0.4 contributors get the better flow throughout
- v0.3 multi-workspace work benefits from the interactive prompts (already
  there for `--workspace-id` selection)
- v0.2 has slack in its current scope (mostly Vectorize/AI work) to absorb
  2.5 days of CLI tooling

**Verdict: pull to v0.2.** Defer the HTTP-endpoint UX (Option B) to v1.0.

---

## 6. Open decisions for v0.2 milestone questioning

1. **Accept Option A as v0.2 scope?** (Recommendation: yes.)
2. **Defer Option B to v1.0?** (Recommendation: yes.)
3. **Should the script generate the `claude_desktop_config.json` snippet
   for copy-paste, or attempt to edit the file directly?** (Recommendation:
   generate snippet only — JSON-editing-other-people's-MCP-configs is the
   exact failure mode that bit Russell in Phase 7.)
4. **What are the sensible defaults for `workspace_id` + `user_id` prompts?**
   - Workspace: derive from git config (`git config user.email` →
     `personal-{email-slug}`)?
   - User: same?
   - Or just `workspace = <user.email>-personal`, `user = <user.email>`?
   - Russell's call — affects every fresh OSS user's first-run experience.
5. **Should `kv:bootstrap-interactive` REPLACE the manual `kv:bootstrap`
   or COMPLEMENT it?** (Recommendation: complement — keep `kv:bootstrap` as
   the scriptable building block for power users / CI / automation. Make
   `kv:bootstrap-interactive` the documented "first time?" path.)

---

## 7. Cross-references

- Issue: [ENG-11](https://linear.app/blackmagicconsulting/issue/ENG-11)
- Existing script: [`scripts/kv-bootstrap.mjs`](../../scripts/kv-bootstrap.mjs)
- Phase 7 CONTEXT.md D-01 (the original deferral decision):
  `.planning/phases/07-deploy-acceptance/07-CONTEXT.md` (if available)
- README first-run docs: [`README.md`](../../README.md) Step 4
- ENG-7 (CWD bug, already fixed): commit `6b969a9`
