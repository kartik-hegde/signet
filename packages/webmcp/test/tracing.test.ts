import { describe, expect, it, vi } from "vitest";

import { ToolError } from "../src/index.js";
import {
  TraceAssembler,
  otlpObserver,
  toOtlpJson,
} from "../src/opentelemetry.js";
import type { GuardEvent } from "../src/index.js";

const event = (
  stage: GuardEvent["stage"],
  timestamp: number,
  overrides: Partial<GuardEvent> = {},
): GuardEvent => ({
  invocationId: "invocation-1",
  name: "checkout",
  stage,
  timestamp,
  durationMs: timestamp - 1_000,
  ...overrides,
});

describe("TraceAssembler", () => {
  it("assembles one invocation with ordered phase spans", () => {
    const assembler = new TraceAssembler();
    assembler.observe(event("started", 1_000));
    assembler.observe(event("validated", 1_002));
    assembler.observe(event("authorized", 1_005));
    assembler.observe(event("executed", 1_017));
    const trace = assembler.observe(event("succeeded", 1_018));

    expect(trace).toMatchObject({
      invocationId: "invocation-1",
      sequence: 1,
      name: "checkout",
      durationMs: 18,
      outcome: "succeeded",
      resultSource: "executed",
    });
    expect(
      trace?.phases.map(({ name, durationMs }) => [name, durationMs]),
    ).toEqual([
      ["signett.validate", 2],
      ["signett.authorize", 3],
      ["signett.execute", 12],
    ]);
  });

  it("continues a host trace and preserves agent call order", () => {
    const assembler = new TraceAssembler();
    assembler.observe(
      event("started", 1_000, {
        callerTelemetry: {
          version: 1,
          traceparent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          toolCallId: "call-42",
          sequence: 7,
          agent: { name: "support-agent", version: "2.1" },
          model: { provider: "openai", name: "gpt-5" },
        },
      }),
    );
    const trace = assembler.observe(event("succeeded", 1_005));

    expect(trace).toMatchObject({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentSpanId: "00f067aa0ba902b7",
      sequence: 7,
      callerTelemetry: {
        toolCallId: "call-42",
        agent: { name: "support-agent" },
        model: { provider: "openai", name: "gpt-5" },
      },
    });
  });

  it("classifies errors without retaining messages or stacks", () => {
    const assembler = new TraceAssembler();
    const failure = new ToolError({
      code: "inventory_unavailable",
      message: "secret upstream response",
      retryable: true,
    });
    assembler.observe(event("started", 1_000));
    const trace = assembler.observe(event("failed", 1_004, { error: failure }));

    expect(trace?.error).toEqual({
      type: "ToolError",
      code: "inventory_unavailable",
      retryable: true,
    });
    expect(JSON.stringify(trace)).not.toContain("secret upstream response");
  });

  it("represents confirmation, replay, output, verification, and late abort", () => {
    const assembler = new TraceAssembler();
    assembler.observe(event("started", 1_000));
    assembler.observe(event("validated", 1_001));
    assembler.observe(event("authorized", 1_002));
    assembler.observe(event("confirmation_requested", 1_003));
    assembler.observe(event("confirmed", 1_006));
    assembler.observe(event("replayed", 1_008));
    assembler.observe(event("output_oversized", 1_009));
    assembler.observe(event("verified", 1_011));
    assembler.observe(event("completed_after_abort", 1_012));
    const trace = assembler.observe(event("succeeded", 1_013));

    expect(trace).toMatchObject({
      outcome: "replayed",
      resultSource: "replayed",
      completedAfterAbort: true,
    });
    expect(trace?.phases.map(({ name }) => name)).toEqual([
      "signett.validate",
      "signett.authorize",
      "signett.confirm",
      "signett.replay",
      "signett.output",
      "signett.verify",
    ]);
  });

  it("classifies recovery and each expected terminal outcome", () => {
    const recovered = new TraceAssembler();
    recovered.observe(event("started", 1_000));
    recovered.observe(event("recovered", 1_005));
    expect(recovered.observe(event("succeeded", 1_006))?.outcome).toBe(
      "recovered",
    );

    const cases = [
      [
        Object.assign(new Error("no"), {
          name: "AuthorizationError",
          code: "authorization_denied",
        }),
        "denied",
      ],
      [
        Object.assign(new Error("no"), {
          name: "ConfirmationError",
          code: "confirmation_declined",
        }),
        "declined",
      ],
      [Object.assign(new Error("stop"), { name: "AbortError" }), "cancelled"],
      [new Error("boom"), "failed"],
    ] as const;
    for (const [failure, outcome] of cases) {
      const assembler = new TraceAssembler();
      assembler.observe(event("started", 1_000));
      expect(
        assembler.observe(event("failed", 1_003, { error: failure }))?.outcome,
      ).toBe(outcome);
    }

    const unknown = new TraceAssembler();
    unknown.observe(event("started", 1_000));
    expect(
      unknown.observe(
        event("outcome_unknown", 1_003, {
          error: Object.assign(new Error("ambiguous"), {
            name: "OutcomeUnknownError",
            code: "outcome_unknown",
          }),
        }),
      )?.outcome,
    ).toBe("unknown");
  });

  it("uses the failure boundary that was active", () => {
    const confirmation = new TraceAssembler();
    confirmation.observe(event("started", 1_000));
    confirmation.observe(event("confirmation_requested", 1_001));
    expect(
      confirmation
        .observe(event("failed", 1_004, { error: new Error() }))
        ?.phases.at(-1)?.name,
    ).toBe("signett.confirm");

    const finalization = new TraceAssembler();
    finalization.observe(event("started", 1_000));
    finalization.observe(event("executed", 1_002));
    expect(
      finalization
        .observe(event("failed", 1_004, { error: new Error() }))
        ?.phases.at(-1)?.name,
    ).toBe("signett.finalize");
  });

  it("drops malformed caller metadata and bounds long fields", () => {
    const assembler = new TraceAssembler();
    assembler.observe(
      event("started", 1_000, {
        callerTelemetry: {
          version: 1,
          traceparent: "not-a-traceparent",
          tracestate: "bad\nstate",
          toolCallId: "x".repeat(200),
          sequence: -1,
          agent: { name: "\u0000bad" },
        },
      }),
    );
    const trace = assembler.observe(event("succeeded", 1_001));

    expect(trace?.parentSpanId).toBeUndefined();
    expect(trace?.callerTelemetry).toEqual({
      version: 1,
      toolCallId: "x".repeat(128),
    });
    expect(trace?.sequence).toBe(1);
  });
});

describe("OTLP JSON", () => {
  it("emits standard root and child spans with caller metadata", () => {
    const assembler = new TraceAssembler();
    assembler.observe(
      event("started", 1_000, {
        callerTelemetry: {
          version: 1,
          toolCallId: "call-1",
          model: { provider: "openai", name: "gpt-5" },
        },
      }),
    );
    assembler.observe(event("executed", 1_009));
    const trace = assembler.observe(event("succeeded", 1_010));
    const body = toOtlpJson([trace!], { serviceName: "storefront" });
    const serialized = JSON.stringify(body);

    expect(serialized).toContain('"service.name"');
    expect(serialized).toContain("storefront");
    expect(serialized).toContain("gen_ai.tool.call.id");
    expect(serialized).toContain("call-1");
    expect(serialized).toContain("signett.execute");
    expect(serialized).not.toContain("description");
  });

  it("batches and posts completed traces without surfacing exporter failure", async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const observe = otlpObserver({
      url: "http://collector.example/v1/traces",
      flushIntervalMs: 60_000,
      fetch: send,
    });
    void observe(event("started", 1_000));
    void observe(event("executed", 1_003));
    void observe(event("succeeded", 1_004));
    await observe.flush();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      "http://collector.example/v1/traces",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    await observe.shutdown();
  });

  it("swallows transport failures and ignores calls after shutdown", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    const observe = otlpObserver({
      url: "http://collector.example/v1/traces",
      flushIntervalMs: 0,
      maxQueue: 1,
      resource: { "deployment.environment.name": "test" },
      fetch: send,
    });
    void observe(event("started", 1_000));
    void observe(event("succeeded", 1_001));
    await observe.flush();
    await expect(observe.shutdown()).resolves.toBeUndefined();
    void observe(event("started", 1_002));
    await observe.flush();

    expect(send).toHaveBeenCalledOnce();
  });
});
