// AI-05 Triage Worker extraction eval — fixture loader.
//
// Replaces the deprecated promptfoo `sharedTests: { file, transform }` pattern
// (removed in promptfoo 0.121.x) with the current canonical external-loader
// pattern: `tests: file://./load-fixtures.mjs` in YAML, default export returns
// a `{description, vars}[]` array.
//
// Shared assertions (`type: is-json` for the JSON-parse-rate gate) live in the
// YAML's `defaultTest.assert` — applied automatically to every test loaded here.
//
// The SYSTEM_PROMPT is sourced directly from packages/triage-worker/src/prompts.ts
// (the runtime source-of-truth, BYTE-FROZEN per spike-findings-engram §6) so the
// eval prompt always matches what the deployed Triage Worker actually uses.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(
  __dirname,
  "../../mcp-server/src/__tests__/evals/fixtures/reference-corpus.json",
);
const promptsPath = join(__dirname, "../src/prompts.ts");

// Extract SYSTEM_PROMPT from prompts.ts source. The .ts isn't directly importable
// here (promptfoo runs the loader as plain ESM); we read the file and pull the
// literal via regex. This matches the source-of-truth contract: any change to
// SYSTEM_PROMPT in prompts.ts is reflected in the next eval run.
//
// Regex tolerates an optional `as const` between the closing backtick and the
// terminating semicolon (current prompts.ts uses `\`...\` as const;`).
const tsSource = readFileSync(promptsPath, "utf8");
const promptMatch = tsSource.match(
  /export const SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`(?:\s+as\s+const)?\s*;/,
);
if (!promptMatch) {
  throw new Error(
    `Could not extract SYSTEM_PROMPT from ${promptsPath} — check that the const declaration uses a template literal.`,
  );
}
const SYSTEM_PROMPT = promptMatch[1];

export default function () {
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  return corpus.map((ex) => ({
    description: `${ex.bucket}/${ex.id} — ${ex.expected_classified_type}`,
    vars: {
      system_prompt: SYSTEM_PROMPT,
      memory_content: ex.original_content,
    },
  }));
}
