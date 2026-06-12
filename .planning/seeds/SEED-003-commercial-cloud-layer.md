---
id: SEED-003
status: dormant
planted: 2026-06-12
planted_during: v0.3 (Identity + Surface) milestone scoping — /gsd:new-milestone
trigger_when: v1.0 — Public Launch (BEFORE any marketing / public signup / billing phase is planned)
scope: large
---

# SEED-003: Commercial cloud layer ships in a separate private `engram-cloud` repo that consumes `engram-web`

## Why This Matters

Engram is open core: `engram-web` (the v0.3 product surface — auth, inbox, memory browser, admin) is Apache-2.0 and self-hostable forever. The **commercial layer** — marketing pages, public sign-up funnel, Stripe billing, plan management, and the multi-tenant control plane that provisions/meters paying workspaces — is the business moat and must **not** live in the OSS-licensed core.

Locked decision (PROJECT.md Key Decisions, 2026-06-12): the commercial layer ships at **v1.0** in a **separate private `engram-cloud` repo** that depends on `engram-web` as a package. `engram-web` must never depend on commercial code.

v0.3 deliberately plants the seams so this is an *add*, not a rewrite:

- **`REGISTRATION_MODE` (`invite` | `open`)** — the hosted product flips to `open` and puts the signup/billing funnel in front of the same magic-link auth. Self-hosted stays `invite`.
- **`DEPLOYMENT_MODE` (`self-hosted` | `cloud`)** — the gate cloud-only concerns hang off.
- **Modular workspace provisioning** — a single function the auth path calls; v1.0's billing-gated path (charge → then provision) wraps it without touching the core.

If these seams drift or get bypassed during v0.3–v0.5, the v1.0 commercial layer becomes a fork/rewrite instead of a wrapper. This seed exists to verify the seams held before commercial work starts.

## When to Surface

**Trigger:** Run before the first phase of **v1.0 — Public Launch** is planned. Specifically before `/gsd:plan-phase` for any phase that introduces marketing pages, public self-service signup, Stripe/billing, or multi-tenant provisioning.

Surfaces during `/gsd:new-milestone` when v1.0 scope is being defined.

## Design questions to answer at v1.0

1. **Dependency mechanism:** how does the private `engram-cloud` repo consume `engram-web` — npm package publish, git submodule, monorepo-of-monorepos, or vendored build artifact?
2. **Did the seams hold?** Audit `engram-web` for any commercial coupling that leaked in during v0.3–v0.5. Confirm `REGISTRATION_MODE=open` + the modular provisioning hook are sufficient to build the billing-gated signup on top without core changes.
3. **Billing-gated provisioning:** the charge → provision ordering, failed-payment teardown, plan limits enforced where (Worker? DO? control plane?).
4. **Multi-tenant control plane:** how the cloud layer maps paying customers → workspaces → the existing per-workspace DO isolation. (Relates to v0.4 multi-workspace work — SEED-001.)
5. **Marketing site hosting:** same Workers Static Assets pattern as `engram-web`, or a separate static host? Shared design system with the product surface?

## Breadcrumbs

- `.planning/PROJECT.md` — Key Decisions row "Open-core repo boundary" (2026-06-12); "Open core (self-hosted free, managed $5–20/mo)" decision
- `.planning/REQUIREMENTS.md` (v0.3) — WEB section "Open-core seam discipline" note; AUTH-08 (`REGISTRATION_MODE`), AUTH-09 (`ENGRAM_OWNER_EMAIL`)
- `CLAUDE.md` — "Open core business model" milestone arc; v1.0 = managed hosting, Stripe billing, OSS launch
- Related: [[SEED-001-cross-layer-recall-fanout]] (multi-workspace substrate the control plane needs)
