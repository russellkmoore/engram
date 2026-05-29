/**
 * AI-SPEC.md §5 dimension #2 — embedding+query model+version consistency drift guard.
 *
 * Promotes Plan 05-04 Task 2's cross-file identity test (still lives in
 * `ai-helper-identity.test.ts`) to a dedicated AI-SPEC eval file. Both
 * tests CO-EXIST: the Plan 05-04 file is the per-PR drift guard, this
 * file is the AI-SPEC §5 dimension #2 framing.
 *
 * Failure mode this guards against: a future commit changes
 * `EMBEDDING_MODEL` in one ai-helper.ts but not the other, producing
 * silent dual-model embeddings that quietly degrade recall F1 over
 * weeks without any test or runtime error.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMBEDDING_MODEL, EMBEDDING_VERSION, CLASSIFIER_MODEL } from "../../ai-helper.js";

describe("AI-SPEC.md §5 dimension #2: embedding/query model+version consistency", () => {
  it("EMBEDDING_MODEL / EMBEDDING_VERSION / CLASSIFIER_MODEL constants are identical across mcp-server and triage-worker ai-helper", () => {
    const triagePath = resolve(import.meta.dirname, "../../../../triage-worker/src/ai-helper.ts");
    const triageContent = readFileSync(triagePath, "utf8");
    expect(triageContent).toContain(`EMBEDDING_MODEL = "${EMBEDDING_MODEL}"`);
    expect(triageContent).toContain(`EMBEDDING_VERSION = ${String(EMBEDDING_VERSION)}`);
    expect(triageContent).toContain(`CLASSIFIER_MODEL = "${CLASSIFIER_MODEL}"`);
  });

  it("EMBEDDING_MODEL is the bge-base-en-v1.5 preset locked at Vectorize index creation (AI-01)", () => {
    expect(EMBEDDING_MODEL).toBe("@cf/baai/bge-base-en-v1.5");
    expect(EMBEDDING_VERSION).toBe(1);
  });

  it("CLASSIFIER_MODEL is llama-3.1-8b-instruct (AI-05 classifier)", () => {
    expect(CLASSIFIER_MODEL).toBe("@cf/meta/llama-3.1-8b-instruct");
  });
});
