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
          "[already_shipped] Shipped orders cannot be cancelled. (retryable: no)",
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
    expect(error.details).toBeUndefined();
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
