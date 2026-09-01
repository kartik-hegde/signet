import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "../../.worktrees/**",
      "../../fixtures/cypress-realworld-app/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/types.ts",
        // The React hook is a thin wrapper; the shared lifecycle is covered directly
        // and the adapter is typechecked against its peer.
        "src/react.ts",
        "src/inspector.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
