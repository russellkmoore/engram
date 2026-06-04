---
status: partial
phase: 01-foundation-wave-0
source: [01-VERIFICATION.md]
started: 2026-06-04T08:05:00Z
updated: 2026-06-04T08:05:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Corpus label quality spot-check
expected: Pick 10 random entries from the validate-split (jq '.entries[] | select(.split == "validate")' .planning/evals/recall-corpus.json). For each, read the query string and the three expected_top_3_block_ids; cross-reference the corresponding ef-* memories in eval-fixtures-seed.json. Confirm the labels are semantically defensible. AI cross-validation may have mismatched on edge-bucket queries — surface any that look wrong as a gap (rcv2 ID + reason).
result: [pending]

### 2. GitHub Actions secrets confirmation
expected: Run `gh secret list | grep -E "WORKSPACE_NAMESPACE_ID|ENGRAM_ADMIN_AUDIT_TOKEN"` and confirm both secrets appear. (User confirmed "done" during execution; this is a verifier-level re-attest because the verifier cannot observe GitHub's secret store.)
result: [pending]

### 3. CI migration audit end-to-end
expected: Push a PR (or wait for a scheduled CI run on main). Confirm the `Migration audit (PRE-01)` step completes with `count_stale=0` across all enumerated workspaces. The mcp-server Worker + WorkspaceDO namespace must be deployed for this to succeed; if not yet deployed, mark as `pending — deploy first`.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
