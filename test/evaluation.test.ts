import { describe, expect, it, vi } from "vitest";

import { evaluateAgentTasks } from "../src/testing.js";

describe("evaluateAgentTasks", () => {
  it("scores selection, arguments, and authoritative completion separately", async () => {
    const invoke = vi.fn(({ input }) => ({ products: [input.query] }));
    const report = await evaluateAgentTasks({
      tasks: [
        {
          name: "find boots",
          prompt: "Find boots",
          expectedTool: "search_products",
          acceptsArguments: (input) => typeof input.query === "string",
          verifies: (output) =>
            (output as { products: unknown[] }).products.length === 1,
        },
        {
          name: "find hats",
          prompt: "Find hats",
          expectedTool: "search_products",
          verifies: () => true,
        },
      ],
      select: (task) =>
        task.name === "find boots"
          ? { tool: "search_products", input: { query: "boots" } }
          : { tool: "get_data", input: {} },
      invoke,
    });

    expect(report).toMatchObject({
      selectionAccuracy: 0.5,
      argumentAccuracy: 0.5,
      completionRate: 0.5,
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("reports no rate for an empty task suite", async () => {
    await expect(
      evaluateAgentTasks({
        tasks: [],
        select: () => {
          throw new Error("not called");
        },
        invoke: () => undefined,
      }),
    ).resolves.toMatchObject({
      selectionAccuracy: null,
      argumentAccuracy: null,
      completionRate: null,
    });
  });

  it("records agent failures without aborting the suite", async () => {
    const failure = new Error("agent unavailable");
    const report = await evaluateAgentTasks({
      tasks: [
        {
          name: "failure",
          prompt: "Try a task",
          expectedTool: "try_task",
          verifies: () => true,
        },
      ],
      select: () => Promise.reject(failure),
      invoke: () => undefined,
    });
    expect(report.results[0]).toMatchObject({
      error: failure,
      completed: false,
    });
  });

  it("preserves successful selection metrics when invocation fails", async () => {
    const failure = new Error("tool failed");
    const report = await evaluateAgentTasks({
      tasks: [
        {
          name: "failure",
          prompt: "Try a task",
          expectedTool: "try_task",
          verifies: () => true,
        },
      ],
      select: () => ({ tool: "try_task", input: {} }),
      invoke: () => Promise.reject(failure),
    });
    expect(report).toMatchObject({
      selectionAccuracy: 1,
      argumentAccuracy: 1,
      completionRate: 0,
    });
    expect(report.results[0]).toMatchObject({ error: failure });
  });
});
