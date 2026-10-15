// ESLint flat config. Formatting is left entirely to Prettier: ESLint's
// recommended set no longer contains stylistic rules, so the two do not clash
// and no bridging package is needed.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/",
      "test-results/",
      "playwright-report/",
      // Imported verbatim; see .prettierignore.
      "public/",
    ],
  },
  js.configs.recommended,
  {
    // Build tooling, configs and tests all run under Node.
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    // Browser tests also hand callbacks to page.evaluate(), which run inside
    // the page, so `window` and `document` are legitimate there.
    files: ["test/e2e/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
