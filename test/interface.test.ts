import { describe, expect, it, vi } from "vitest";

import { createSignet, type ModelContextLike } from "../src/index.js";

function modelContext() {
  const registrations = new Map<
    string,
    {
      tool: Parameters<ModelContextLike["registerTool"]>[0];
      signal?: AbortSignal;
    }
  >();

  const context: ModelContextLike = {
    async registerTool(tool, options) {
      registrations.set(tool.name, {
        tool,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      options?.signal?.addEventListener(
        "abort",
        () => registrations.delete(tool.name),
        { once: true },
      );
    },
  };

  return { context, registrations };
}

const schema = {
  type: "object",
  properties: { value: { type: "number" } },
  required: ["value"],
  additionalProperties: false,
};

describe("createSignet", () => {
  it("observes registration and invocation as one privacy-safe lifecycle", async () => {
    const native = modelContext();
    const events: import("../src/index.js").GuardEvent[] = [];
    const signet = createSignet({
      modelContext: native.context,
      observe: (event) => {
        events.push(event);
      },
    });

    const registration = await signet.expose({
      name: "observed",
      description: "An observed tool.",
      inputSchema: schema,
      execute: ({ value }: { value: number }) => value,
    });
    await native.registrations
      .get("observed")
      ?.tool.execute({ value: 1 }, { signal: new AbortController().signal });
    registration.dispose();

    expect(events.map((event) => event.stage)).toEqual([
      "registering",
      "registered",
      "started",
      "validated",
      "executed",
      "succeeded",
      "unregistered",
    ]);
    expect(JSON.stringify(events)).not.toContain("value");
  });

  it("exposes a four-field tool through native registration", async () => {
    const native = modelContext();
    const signet = createSignet({ modelContext: native.context });

    const registration = await signet.expose({
      name: "double",
      description: "Double one number.",
      inputSchema: schema,
      execute: ({ value }: { value: number }) => value * 2,
    });

    expect(registration.status).toBe("registered");
    expect(native.registrations.get("double")?.tool.description).toBe(
      "Double one number.",
    );
    await expect(
      native.registrations
        .get("double")
        ?.tool.execute({ value: 3 }, { signal: new AbortController().signal }),
    ).resolves.toBe(6);
  });

  it("passes application context and execution signal to the tool", async () => {
    const native = modelContext();
    const signal = new AbortController().signal;
    const execute = vi.fn(
      (
        input: { value: number },
        options: { context: { userId: string }; signal: AbortSignal },
      ) => {
        expect(options).toEqual({
          context: { userId: "user-1" },
          signal,
        });
        return input.value;
      },
    );
    const signet = createSignet({
      modelContext: native.context,
      context: () => ({ userId: "user-1" }),
    });

    await signet.expose({
      name: "contextual",
      description: "Use current application context.",
      inputSchema: schema,
      execute,
    });
    await native.registrations
      .get("contextual")
      ?.tool.execute({ value: 1 }, { signal });

    expect(execute).toHaveBeenCalledOnce();
  });

  it("composes authoritative recovery into an exposed tool", async () => {
    const native = modelContext();
    const signet = createSignet({ modelContext: native.context });
    await signet.expose<{ value: number }, number>({
      name: "recoverable",
      description: "Recover a committed operation whose response was lost.",
      inputSchema: schema,
      execute: () => {
        throw new Error("response lost");
      },
      recover: ({ input }) => ({
        recovered: true,
        output: input.value * 2,
      }),
      verify: ({ output, recovered }) => recovered && output === 4,
    });

    await expect(
      native.registrations
        .get("recoverable")
        ?.tool.execute({ value: 2 }, { signal: new AbortController().signal }),
    ).resolves.toBe(4);
  });

  it("disposes the native registration idempotently", async () => {
    const native = modelContext();
    const signet = createSignet({ modelContext: native.context });
    const registration = await signet.expose({
      name: "temporary",
      description: "A temporary tool.",
      inputSchema: schema,
      execute: () => undefined,
    });

    registration.dispose();
    registration.dispose();

    expect(registration.status).toBe("disposed");
    expect(native.registrations.has("temporary")).toBe(false);
  });

  it("does not break an ordinary browser without WebMCP", async () => {
    const signet = createSignet({ unsupported: "ignore" });
    const registration = await signet.expose({
      name: "optional",
      description: "Only available with WebMCP.",
      inputSchema: schema,
      execute: () => undefined,
    });

    expect(registration.status).toBe("unsupported");
    registration.dispose();
    expect(registration.status).toBe("disposed");
  });

  it("can fail strictly when WebMCP is unavailable", async () => {
    const signet = createSignet({ unsupported: "throw" });

    await expect(
      signet.expose({
        name: "strict",
        description: "Require native WebMCP.",
        inputSchema: schema,
        execute: () => undefined,
      }),
    ).rejects.toThrow("WebMCP is not available");
  });

  it("rejects invalid and duplicate definitions", async () => {
    const native = modelContext();
    const signet = createSignet({ modelContext: native.context });
    const tool = {
      name: "stable",
      description: "A stable tool.",
      inputSchema: schema,
      execute: () => undefined,
    };

    await signet.expose(tool);
    await expect(signet.expose(tool)).rejects.toThrow("already exposed");
    await expect(
      signet.expose({ ...tool, name: "not valid!" }),
    ).rejects.toThrow("name must be");
  });
});
