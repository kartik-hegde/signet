import { describe, expect, it, vi } from "vitest";

import {
  ToolError,
  ValidationError,
  createSignet,
  type ModelContextLike,
} from "../src/index.js";

function capture() {
  let tool: Parameters<ModelContextLike["registerTool"]>[0] | undefined;
  const modelContext: ModelContextLike = {
    async registerTool(next) {
      tool = next;
    },
  };
  return {
    modelContext,
    get tool() {
      return tool;
    },
  };
}

const schema = {
  type: "object",
  properties: {
    orderId: { type: "string", minLength: 1 },
  },
  required: ["orderId"],
  additionalProperties: false,
};

describe("Signet validation and expected errors", () => {
  it("rejects an invalid schema before native registration", async () => {
    const native = capture();
    const signet = createSignet({ modelContext: native.modelContext });

    await expect(
      signet.expose({
        name: "broken",
        description: "A broken tool.",
        inputSchema: { type: "not-a-json-schema-type" },
        execute: () => undefined,
      }),
    ).rejects.toThrow("inputSchema is not a valid JSON Schema");
    expect(native.tool).toBeUndefined();
  });

  it("rejects an invalid verification timeout before registration", async () => {
    const native = capture();
    const signet = createSignet({ modelContext: native.modelContext });

    await expect(
      signet.expose({
        name: "broken_timeout",
        description: "A tool with an invalid timeout.",
        inputSchema: schema,
        execute: () => undefined,
        verify: () => true,
        verifyTimeoutMs: 0,
      }),
    ).rejects.toThrow("verifyTimeoutMs must be a positive integer");
    expect(native.tool).toBeUndefined();
  });

  it("rejects invalid input before context and execution", async () => {
    const native = capture();
    const context = vi.fn(() => ({ userId: "user-1" }));
    const execute = vi.fn();
    const signet = createSignet({
      modelContext: native.modelContext,
      context,
    });
    await signet.expose({
      name: "cancel_order",
      description: "Cancel an order.",
      inputSchema: schema,
      execute,
    });

    const invocation = native.tool?.execute(
      { orderId: "", unexpected: true },
      { signal: new AbortController().signal },
    );
    await expect(invocation).rejects.toEqual(
      expect.objectContaining({
        name: "ValidationError",
        code: "invalid_input",
        message: expect.stringMatching(/orderId.*too short/i),
        issues: expect.arrayContaining([
          expect.objectContaining({ keyword: "additionalProperties" }),
          expect.objectContaining({ keyword: "minLength" }),
        ]),
      }),
    );
    expect(context).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves expected business errors", async () => {
    const native = capture();
    const signet = createSignet({ modelContext: native.modelContext });
    await signet.expose({
      name: "cancel_order",
      description: "Cancel an order.",
      inputSchema: schema,
      execute: () => {
        throw new ToolError({
          code: "already_shipped",
          message: "Shipped orders cannot be cancelled.",
          retryable: false,
          details: { alternative: "return_order" },
        });
      },
    });

    const invocation = native.tool?.execute(
      { orderId: "ord_1" },
      { signal: new AbortController().signal },
    );
    await expect(invocation).rejects.toEqual(
      expect.objectContaining({
        name: "ToolError",
        code: "already_shipped",
        message:
          "[already_shipped] Shipped orders cannot be cancelled. [retry: never]",
        retryable: false,
        details: { alternative: "return_order" },
      }),
    );
  });

  it("uses safe defaults for ToolError", () => {
    const error = new ToolError({
      code: "conflict",
      message: "The operation conflicts with current state.",
    });

    expect(error.retryable).toBe(false);
    expect(error.retry).toBe("never");
    expect(error.details).toBeUndefined();
  });

  it("distinguishes as-is retry from repair-gated retry", () => {
    const error = new ToolError({
      code: "rate_limited",
      message: "Try again later.",
      retryable: true,
    });

    expect(error.retry).toBe("as_is");
    expect(error.message).toContain("[retry: as_is]");
  });

  it("serializes explicit repair guidance for agent boundaries", () => {
    const repair = {
      action: "call_tool" as const,
      tool: "list_available_slots",
      instruction:
        "Refresh availability, then retry with the same operationId.",
    };
    const error = new ToolError({
      code: "slot_stale",
      message: "The selected slot is no longer available.",
      retry: "after_repair",
      repair,
    });

    expect(error.repair).toBe(repair);
    expect(error.retry).toBe("after_repair");
    expect(error.message).toBe(
      "[slot_stale] The selected slot is no longer available. " +
        "[retry: after_repair] " +
        "Next action: call_tool list_available_slots — " +
        "Refresh availability, then retry with the same operationId. " +
        "Wait for list_available_slots to finish before continuing.",
    );
  });

  it("serializes ordered repair plans and input invariants", () => {
    const error = new ToolError({
      code: "source_stale",
      message: "The source state changed.",
      retry: "after_repair",
      repair: {
        steps: [
          {
            action: "call_tool",
            tool: "list_accounts",
            instruction: "Refresh the source state.",
          },
          {
            action: "call_tool",
            tool: "prepare_authorization",
            instruction: "Create a replacement authorization.",
          },
          {
            action: "retry_same_operation",
            instruction: "Retry this tool with the replacement authorization.",
          },
        ],
        preserve: ["operationId", "amount"],
        update: ["authorizationId"],
      },
    });

    expect(error.retry).toBe("after_repair");
    expect(error.message).toContain("Repair sequentially; do not parallelize:");
    expect(error.message).toContain(
      "1) call_tool list_accounts — Refresh the source state",
    );
    expect(error.message).toContain("2) call_tool prepare_authorization");
    expect(error.message).toContain("3) retry_same_operation");
    expect(error.message).toContain("Preserve: operationId, amount.");
    expect(error.message).toContain(
      "Update from repair output: authorizationId.",
    );
  });

  it("bounds repair instructions in the cross-boundary message", () => {
    const instruction = "x".repeat(400);
    const repair = { action: "refresh_state" as const, instruction };
    const error = new ToolError({
      code: "stale_state",
      message: "State changed.",
      retry: "after_repair",
      repair,
    });

    expect(error.repair).toBe(repair);
    expect(error.message).toContain("Next action: refresh_state —");
    expect(error.message).not.toContain("x".repeat(301));
    expect(error.message.endsWith("…")).toBe(true);
  });

  it("bounds and normalizes portable repair plans", () => {
    const step = (index: number) => ({
      action: "call_tool" as const,
      tool: `  tool_${index}  `,
      instruction: `Read  current\nstate ${"x".repeat(180)}`,
    });
    const error = new ToolError({
      code: "changing_state",
      message: "State changed.",
      retry: "after_repair",
      repair: {
        steps: [step(1), step(2), step(3), step(4), step(5), step(6)],
        preserve: Array.from({ length: 10 }, (_, index) => ` field_${index} `),
        update: Array.from({ length: 10 }, (_, index) => ` update_${index} `),
      },
    });

    expect(error.message).toContain("call_tool tool_1 —");
    expect(error.message).not.toContain("tool_6");
    expect(error.message).toContain("1 more step(s) omitted");
    expect(error.message).toContain("field_7");
    expect(error.message).not.toContain("field_8");
    expect(error.message).toContain("update_7");
    expect(error.message).not.toContain("update_8");
    expect(error.message).not.toContain("\n");
  });

  it("renders a repair plan without input invariants", () => {
    const error = new ToolError({
      code: "manual_review",
      message: "The operation needs review.",
      retry: "after_repair",
      repair: {
        steps: [
          {
            action: "reconcile",
            instruction: "Check authoritative state before continuing.",
          },
        ],
      },
    });

    expect(error.message).toBe(
      "[manual_review] The operation needs review. [retry: after_repair] " +
        "Repair sequentially; do not parallelize: 1) reconcile — " +
        "Check authoritative state before continuing.",
    );
  });

  it("exports ValidationError for application-level handling", () => {
    const error = new ValidationError([
      { path: "/orderId", message: "is required", keyword: "required" },
    ]);

    expect(error.code).toBe("invalid_input");
    expect(error.message).toBe("Invalid tool input — /orderId: is required.");
    expect(error.issues).toHaveLength(1);
  });

  it("normalizes punctuation from schema-validator messages", () => {
    const error = new ValidationError([
      { path: "/query", message: "String is too long.", keyword: "maxLength" },
    ]);
    expect(error.message).toBe(
      "Invalid tool input — /query: String is too long.",
    );
  });

  it("caps agent-facing validation details", () => {
    const error = new ValidationError(
      Array.from({ length: 5 }, (_, index) => ({
        path: `/field${index}`,
        message: "is invalid",
        keyword: "type",
      })),
    );

    expect(error.message).toContain("/field0: is invalid");
    expect(error.message).not.toContain("/field3");
    expect(error.message).toContain("plus 2 more issues");
    expect(error.message.length).toBeLessThanOrEqual(300);
  });
});
