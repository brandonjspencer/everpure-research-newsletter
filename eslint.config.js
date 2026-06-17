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
  {
    // These two files carry a superseded block of duplicate function
    // definitions (the later defs win at runtime; the earlier block is dead).
    // Cleaning it out is a separate, reviewed change — until then, don't fail CI
    // on the known redeclarations here. no-redeclare stays an ERROR everywhere else.
    files: ["netlify/render_stage2_default_current.js", "netlify/functions/api.js"],
    rules: {
      "no-redeclare": "warn",
    },
  },
  prettier,
];
