import { describe, expect, it, vi } from "vitest";

import { bindSignetTool, type ToolBindingState } from "../src/lifecycle.js";
import type { SignetInterface, SignetRegistration } from "../src/interface.js";

const tool = {
  name: "search_products",
  description: "Return matching products.",
  inputSchema: { type: "object" },
  execute: () => undefined,
};

describe("bindSignetTool", () => {
  it("reports and disposes a mounted registration", async () => {
    const registration = {
      name: tool.name,
      status: "registered" as const,
      dispose: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    };
    const states: ToolBindingState[] = [];
    const teardown = bindSignetTool(
      {
        expose: () => Promise.resolve(registration),
        tools: () => [],
        observe: () => () => undefined,
      },
      tool,
      (state) => states.push(state),
    );
    await Promise.resolve();

    expect(states).toEqual([
      { status: "registering" },
      { status: "registered" },
    ]);
    teardown();
    expect(registration.dispose).toHaveBeenCalledOnce();
  });

  it("disposes a registration that resolves after teardown", async () => {
    let resolve: ((value: SignetRegistration) => void) | undefined;
    const registration = {
      name: tool.name,
      status: "registered" as const,
      dispose: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    };
    const signet: SignetInterface<undefined> = {
      expose: () =>
        new Promise((done) => {
          resolve = done;
        }),
      tools: () => [],
      observe: () => () => undefined,
    };
    const states: ToolBindingState[] = [];

    const teardown = bindSignetTool(signet, tool, (state) => {
      states.push(state);
    });
    teardown();
    resolve?.(registration);
    await Promise.resolve();

    expect(registration.dispose).toHaveBeenCalledOnce();
    expect(states).toEqual([{ status: "registering" }]);
  });

  it("reports registration failure while mounted", async () => {
    const failure = new Error("registration failed");
    const states: ToolBindingState[] = [];
    bindSignetTool(
      {
        expose: () => Promise.reject(failure),
        tools: () => [],
        observe: () => () => undefined,
      },
      tool,
      (state) => states.push(state),
    );
    await Promise.resolve();
    expect(states).toEqual([
      { status: "registering" },
      { status: "error", error: failure },
    ]);
  });
});
