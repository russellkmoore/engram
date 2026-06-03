// eslint.config.mjs
// Source: typescript-eslint.io/users/configs/, eslint.org flat config docs
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/worker-configuration.d.ts",
      // Throwaway spike code lives outside the tsconfig project and is exempt
      // from the strict project lint rules — gsd-managed under .planning/spikes/.
      // The wrap-up workflow also copies spike sources under .claude/skills/
      // for future builds to reference; same exemption applies.
      ".planning/spikes/**",
      ".claude/skills/spike-findings-*/sources/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.browser, // Workers expose fetch/Request/Response globals
        ...globals.serviceworker,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "*.mjs",
            "*.cjs",
            "scripts/*.mjs",
            "scripts/*.cjs",
            "packages/*/evals/*.mjs",
            "packages/*/evals/*.cjs",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // Root config files (.mjs, .cjs), scripts/, and per-package evals/ loaders
  // are not TypeScript source — disable type-aware rules.
  {
    files: [
      "*.mjs",
      "*.cjs",
      "scripts/**/*.mjs",
      "scripts/**/*.cjs",
      "packages/*/evals/*.mjs",
      "packages/*/evals/*.cjs",
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  // scripts/audit/*.ts — Node.js admin scripts (tsx runtime). Type-checked
  // TypeScript but Node globals required; strict Worker rules do not apply.
  {
    files: ["scripts/audit/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // scripts/ + per-package evals/ run under Node — expose Node globals (process, Buffer, etc.)
  {
    files: [
      "scripts/**/*.mjs",
      "scripts/**/*.cjs",
      "*.mjs",
      "*.cjs",
      "packages/*/evals/*.mjs",
      "packages/*/evals/*.cjs",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
