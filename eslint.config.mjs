import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packages/webmcp/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["packages/webmcp/src/testing.ts"],
    rules: {
      // AbortSignal.reason is intentionally forwarded without changing identity.
      "@typescript-eslint/prefer-promise-reject-errors": "off",
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["packages/chrome-agent/**/*.mjs"],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: Object.fromEntries(
        [
          "AbortController",
          "DOMException",
          "Response",
          "URL",
          "chrome",
          "console",
          "crypto",
          "document",
          "fetch",
          "location",
          "performance",
          "process",
          "requestAnimationFrame",
          "setTimeout",
          "clearTimeout",
          "window",
        ].map((name) => [name, "readonly"]),
      ),
      parserOptions: { projectService: false },
    },
  },
);
