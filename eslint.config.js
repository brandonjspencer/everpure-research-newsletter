"use strict";

const js = require("@eslint/js");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

// Flat config (ESLint 9). The codebase is Node CommonJS.
module.exports = [
  {
    ignores: [
      "node_modules/**",
      "output/**",
      "publish/**",
      "deck_artifacts/**",
      "deck_artifacts_empty/**",
      ".venv/**",
      "docs/**",
      "issues/**",
      "history/**",
      "emails/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      // Surface, don't fail, on legacy stylistic debt; genuine bugs
      // (no-undef, no-redeclare, ...) stay as errors from the recommended set.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  prettier,
];
