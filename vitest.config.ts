import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      ".worktrees/**",
      "examples/cypress-realworld-app/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/types.ts",
        // Framework adapters are one-line lifecycle bindings; the shared lifecycle
        // is covered directly and adapters are typechecked against their peers.
        "src/react.ts",
        "src/vue.ts",
        "src/svelte.ts",
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
