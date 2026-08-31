import { describe, expect, it } from "vitest";

import {
  OutputLimitError,
  assertToolReady,
  checkToolReadiness,
  guard,
} from "../src/index.js";

const active = () => ({ signal: new AbortController().signal });

describe("output limits", () => {
  it("accepts a focused result and observes validation", async () => {
    const stages: string[] = [];
    const execute = guard(async () => ({ id: "one" }), {
      maxOutputBytes: 64,
      observe: ({ stage }) => {
        stages.push(stage);
      },
    });
    await expect(execute({}, active())).resolves.toEqual({ id: "one" });
    expect(stages).toContain("output_validated");
  });

  it("rejects an oversized result with an agent-legible error", async () => {
    const execute = guard(async () => ({ rows: ["one", "two"] }), {
      maxOutputBytes: 5,
    });
    await expect(execute({}, active())).rejects.toBeInstanceOf(
      OutputLimitError,
    );
    await expect(execute({}, active())).rejects.toThrow(
      /\[output_too_large\].*5.*smaller/,
    );
  });
});

describe("tool readiness", () => {
  it("accepts a bounded, descriptive read tool", () => {
    const tool = {
      name: "search_products",
      description: "Find products and return their stable identifiers.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Words from the product name.",
            maxLength: 80,
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      maxOutputBytes: 10_000,
      execute: () => [],
    };
    expect(checkToolReadiness(tool)).toEqual([]);
    expect(() => assertToolReady(tool)).not.toThrow();
  });

  it("reports actionable paths for weak definitions", () => {
    const tool = {
      name: "getData",
      description: "Gets data.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, ids: { type: "array" } },
      },
      maxOutputBytes: 0,
      execute: () => undefined,
    };
    const diagnostics = checkToolReadiness(tool);
    expect(diagnostics.map(({ code }) => code)).toEqual([
      "name",
      "description",
      "closed_input",
      "argument_description",
      "unbounded_string",
      "argument_description",
      "unbounded_array",
      "output_limit",
    ]);
    expect(() => assertToolReady(tool)).toThrow("inputSchema.properties.query");
  });
});
