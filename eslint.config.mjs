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
          allowDefaultProject: ["*.mjs", "*.cjs", "scripts/*.mjs", "scripts/*.cjs"],
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
  // Root config files (.mjs, .cjs) and scripts/ are not TypeScript source — disable type-aware rules
  {
    files: ["*.mjs", "*.cjs", "scripts/**/*.mjs", "scripts/**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  // scripts/ run under Node — expose Node globals (process, Buffer, etc.)
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.cjs", "*.mjs", "*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
