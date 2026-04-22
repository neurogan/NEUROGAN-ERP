// ESLint flat config (ESLint v9 + typescript-eslint v8).
// See AGENTS.md §5.1 for code conventions + §4.3 for regulated-code DoD.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "coverage/",
      "pnpm-lock.yaml",
      "**/*.d.ts",
      "FDA/",
      "tailwind.config.ts",
      "tailwind.config.ts.bak",
      "postcss.config.js",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // AGENTS.md §5.1 + spec D-11 + §3 DoD: never introduce any.
      "@typescript-eslint/no-explicit-any": "error",

      // AGENTS.md §4.5, spec §2.6: always ===.
      eqeqeq: ["error", "always"],

      // Allow underscore-prefixed unused vars (conventional "intentionally unused").
      // caughtErrors: 'none' — don't flag catch (err) if err isn't used; that
      // pattern is idiomatic and not a regulated-code concern.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },

  {
    files: ["client/**/*.{ts,tsx}"],
    ...react.configs.flat.recommended,
    settings: { react: { version: "18.3" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      "react/react-in-jsx-scope": "off", // React 18 automatic JSX runtime
      "react/prop-types": "off", // TypeScript handles prop typing
      // Apostrophes/quotes in JSX text are style, not regulated-code.
      "react/no-unescaped-entities": "off",
      // Radix + shadcn use many custom props; rule is too noisy.
      "react/no-unknown-property": "off",
    },
  },
  {
    files: ["client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // exhaustive-deps is useful but frequently false-positive; ratchet on
      // after a dedicated audit. rules-of-hooks (the real safety rule) stays on.
      "react-hooks/exhaustive-deps": "off",
    },
  },

  // Prettier must be last — disables ESLint rules that conflict with Prettier.
  prettier,
);
