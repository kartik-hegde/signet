import { describe, expect, it, vi } from "vitest";

import { assertToolReady, checkToolReadiness, guard } from "../src/index.js";
import { MemoryIdempotencyStore } from "../src/testing.js";

const active = () => ({ signal: new AbortController().signal });

describe("output limits", () => {
  it("accepts a focused result and observes validation", async () => {
    const stages: string[] = [];
    const execute = guard(async () => ({ id: "one" }), {
      outputBudgetBytes: 64,
      observe: ({ stage }) => {
        stages.push(stage);
      },
    });
    await expect(execute({}, active())).resolves.toEqual({ id: "one" });
    expect(stages).toContain("output_validated");
  });

  it("warns without discarding a completed mutation", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    let effects = 0;
    const stages: string[] = [];
    const execute = guard(
      async () => {
        effects += 1;
        return { rows: ["one", "two"] };
      },
      {
        name: "write_rows",
        outputBudgetBytes: 5,
        idempotency: {
          key: () => "write-1",
          store: new MemoryIdempotencyStore(),
        },
        observe: ({ stage }) => {
          stages.push(stage);
        },
      },
    );
    await expect(execute({}, active())).resolves.toEqual({
      rows: ["one", "two"],
    });
    await expect(execute({}, active())).resolves.toEqual({
      rows: ["one", "two"],
    });
    expect(effects).toBe(1);
    expect(stages.filter((stage) => stage === "output_oversized")).toHaveLength(
      2,
    );
    expect(stages).not.toContain("failed");
    expect(warning).toHaveBeenCalledWith(
      expect.stringMatching(/write_rows.*budget is 5/),
    );
    warning.mockRestore();
  });

  it("does not throw while measuring circular or undefined output", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const stages: string[] = [];
    const circularExecute = guard(async () => circular, {
      outputBudgetBytes: 5,
      observe: ({ stage }) => {
        stages.push(stage);
      },
    });
    const undefinedExecute = guard(async () => undefined, {
      outputBudgetBytes: 5,
      observe: ({ stage }) => {
        stages.push(stage);
      },
    });

    await expect(circularExecute({}, active())).resolves.toBe(circular);
    await expect(undefinedExecute({}, active())).resolves.toBeUndefined();
    expect(stages).toContain("output_unmeasurable");
    expect(stages).toContain("output_validated");
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
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
      outputBudgetBytes: 10_000,
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
      outputBudgetBytes: 0,
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

  it("checks nested objects, array items, alternatives, and definitions", () => {
    const diagnostics = checkToolReadiness({
      name: "search_records",
      description: "Find matching records and return their identifiers.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filters: {
            type: "array",
            description: "Filters applied to the search.",
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                value: {
                  type: "string",
                  description: "Value required by the filter.",
                },
              },
            },
          },
          selector: {
            description: "Selector used to find records.",
            oneOf: [{ type: "string" }, { $ref: "#/$defs/selector" }],
          },
        },
        $defs: {
          selector: { type: "string" },
        },
      },
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "closed_input",
          path: "inputSchema.properties.filters.items.additionalProperties",
        }),
        expect.objectContaining({
          code: "unbounded_string",
          path: "inputSchema.properties.filters.items.properties.value",
        }),
        expect.objectContaining({
          code: "unbounded_string",
          path: "inputSchema.properties.selector.oneOf.0",
        }),
        expect.objectContaining({
          code: "unbounded_string",
          path: "inputSchema.$defs.selector",
        }),
      ]),
    );
  });
});
