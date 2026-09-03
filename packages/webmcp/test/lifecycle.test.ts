import { describe, expect, it, vi } from "vitest";

import { bindSignettTool, type ToolBindingState } from "../src/lifecycle.js";
import type {
  SignettInterface,
  SignettRegistration,
} from "../src/interface.js";

const tool = {
  name: "search_products",
  description: "Return matching products.",
  inputSchema: { type: "object" },
  execute: () => undefined,
};

describe("bindSignettTool", () => {
  it("reports and disposes a mounted registration", async () => {
    const registration = {
      name: tool.name,
      status: "registered" as const,
      dispose: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    };
    const states: ToolBindingState[] = [];
    const teardown = bindSignettTool(
      {
        expose: () => Promise.resolve(registration),
        tools: () => [],
        observe: () => () => undefined,
      },
      tool,
      (state) => states.push(state),
    );
    await vi.waitFor(() => expect(states).toHaveLength(2));

    expect(states).toEqual([
      { status: "registering" },
      { status: "registered" },
    ]);
    teardown();
    expect(registration.dispose).toHaveBeenCalledOnce();
  });

  it("disposes a registration that resolves after teardown", async () => {
    let resolve: ((value: SignettRegistration) => void) | undefined;
    const registration = {
      name: tool.name,
      status: "registered" as const,
      dispose: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    };
    const signett: SignettInterface<undefined> = {
      expose: () =>
        new Promise((done) => {
          resolve = done;
        }),
      tools: () => [],
      observe: () => () => undefined,
    };
    const states: ToolBindingState[] = [];

    const teardown = bindSignettTool(signett, tool, (state) => {
      states.push(state);
    });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    teardown();
    resolve?.(registration);
    await vi.waitFor(() => expect(registration.dispose).toHaveBeenCalledOnce());

    expect(registration.dispose).toHaveBeenCalledOnce();
    expect(states).toEqual([{ status: "registering" }]);
  });

  it("reports registration failure while mounted", async () => {
    const failure = new Error("registration failed");
    const states: ToolBindingState[] = [];
    bindSignettTool(
      {
        expose: () => Promise.reject(failure),
        tools: () => [],
        observe: () => () => undefined,
      },
      tool,
      (state) => states.push(state),
    );
    await vi.waitFor(() => expect(states).toHaveLength(2));
    expect(states).toEqual([
      { status: "registering" },
      { status: "error", error: failure },
    ]);
  });

  it("survives cleanup and remount while registration is in flight", async () => {
    let resolveFirst: ((value: SignettRegistration) => void) | undefined;
    const first = {
      name: tool.name,
      status: "registered" as const,
      dispose: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    };
    const second = {
      name: tool.name,
      status: "registered" as const,
      dispose: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    };
    const expose = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SignettRegistration>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(second);
    const signett = {
      expose,
      tools: () => [],
      observe: () => () => undefined,
    };
    const firstStates: ToolBindingState[] = [];
    const secondStates: ToolBindingState[] = [];

    const cleanupFirst = bindSignettTool(signett, tool, (state) => {
      firstStates.push(state);
    });
    await vi.waitFor(() => expect(expose).toHaveBeenCalledOnce());
    cleanupFirst();
    bindSignettTool(signett, tool, (state) => {
      secondStates.push(state);
    });
    expect(expose).toHaveBeenCalledOnce();

    resolveFirst?.(first);
    await vi.waitFor(() => expect(expose).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(secondStates).toEqual([
        { status: "registering" },
        { status: "registered" },
      ]),
    );

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(firstStates).toEqual([{ status: "registering" }]);
  });
});
