import { describe, expect, it } from "vitest";

import { createSignet } from "../src/index.js";
import { createWebMcpTestHarness } from "../src/testing.js";

describe("createWebMcpTestHarness", () => {
  it("discovers, invokes, cancels, and disposes exposed tools", async () => {
    const harness = createWebMcpTestHarness();
    const signet = createSignet({ modelContext: harness.modelContext });
    const registration = await signet.expose({
      name: "greet",
      description: "Greet one person.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
      execute: ({ name }: { name: string }, { signal }) => {
        signal.throwIfAborted();
        return { greeting: "Hello, " + name };
      },
    });

    expect(harness.tools().map((tool) => tool.name)).toEqual(["greet"]);
    await expect(harness.invoke("greet", { name: "Ada" })).resolves.toEqual({
      greeting: "Hello, Ada",
    });

    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    await expect(
      harness.invoke("greet", { name: "Ada" }, { signal: controller.signal }),
    ).rejects.toBe(reason);

    registration.dispose();
    expect(harness.tools()).toEqual([]);
    await expect(harness.invoke("greet", { name: "Ada" })).rejects.toThrow(
      "not registered",
    );
  });

  it("clears registrations between tests", async () => {
    const harness = createWebMcpTestHarness();
    const signet = createSignet({ modelContext: harness.modelContext });
    await signet.expose({
      name: "temporary",
      description: "Temporary.",
      inputSchema: { type: "object" },
      execute: () => undefined,
    });

    harness.clear();

    expect(harness.tools()).toEqual([]);
  });
});
