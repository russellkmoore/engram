/**
 * Vitest configuration for `@engram/ai-config`.
 *
 * Pure Node pool — no Cloudflare Workers environment needed.
 * Constants-only package: tests assert model ID strings and weight values.
 *
 * @module @engram/ai-config/vitest.config
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
