---
status: resolved
phase: 01-foundation-wave-0
source: [01-VERIFICATION.md]
started: 2026-06-04T08:05:00Z
updated: 2026-06-05T07:35:00Z
---

## Current Test

[all tests resolved]

## Tests

### 1. Corpus label quality spot-check

expected: Pick 10 random entries from the validate-split (jq '.entries[] | select(.split == "validate")' .planning/evals/recall-corpus.json). For each, read the query string and the three expected_top_3_block_ids; cross-reference the corresponding ef-* memories in eval-fixtures-seed.json. Confirm the labels are semantically defensible. AI cross-validation may have mismatched on edge-bucket queries — surface any that look wrong as a gap (rcv2 ID + reason).

result: passed

notes: Approved by user 2026-06-05. AI cross-validated labels accepted as defensible against the synthetic eval-fixtures-seed.json corpus; T-03-AUTO amendment 2aea16d documents the non-circularity argument (Sonnet+Opus labelers vs. Workers AI qwen3-embedding system under test). Audit trail in labeled_by stamps distinguishes auto-accept (19 entries) from auto-accept-tiebreak (81 entries) for any future F1 anomaly investigation.

### 2. GitHub Actions secrets confirmation

expected: Run `gh secret list | grep -E "WORKSPACE_NAMESPACE_ID|ENGRAM_ADMIN_AUDIT_TOKEN"` and confirm both secrets appear.

result: passed

notes: Confirmed during the PRE-01 redesign session — `gh secret list` output verified WORKSPACE_NAMESPACE_ID and ENGRAM_ADMIN_AUDIT_TOKEN both present. Token was rotated 2026-06-05 (new openssl rand -hex 32) and synced to both the Worker secret store and GH Actions; the new value passed both local audit calls and CI runs.

### 3. CI migration audit end-to-end

expected: Push a PR (or wait for a scheduled CI run on main). Confirm the `Migration audit (PRE-01)` step completes with `count_stale=0` across all enumerated workspaces.

result: passed

notes: GitHub Actions run 27001736375 (2026-06-05 07:35Z, HEAD 0e62519) — build job all green including `Migration audit (PRE-01)`; eval-suite job all green. The audit enumerated 2 deployed WorkspaceDOs and reported count_stale=0 for both. Live verification path included one one-shot remediation: 3 stale embeddings from the v0.1→v0.2 model migration (768d→1024d, qwen3-embedding-0.6b cutover) were detected and purged via the new `/__admin/embedding-purge` endpoint (commit fb02d21), confirming the gate works exactly as designed (detect + actionable cleanup path).

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
