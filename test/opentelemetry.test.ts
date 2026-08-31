import { SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";

import { openTelemetryObserver } from "../src/opentelemetry.js";
import type { GuardEvent } from "../src/index.js";

const event = (
  stage: GuardEvent["stage"],
  overrides: Partial<GuardEvent> = {},
): GuardEvent => ({
  invocationId: "invocation-1",
  name: "cancel-order",
  stage,
  timestamp: 1,
  durationMs: 12,
  ...overrides,
});

const harness = () => {
  const span = {
    addEvent: vi.fn(),
    end: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
  } as unknown as Span;
  const tracer = {
    startSpan: vi.fn(() => span),
  } as unknown as Tracer;
  return { span, tracer };
};

describe("openTelemetryObserver", () => {
  it("creates and closes a successful span", () => {
    const { span, tracer } = harness();
    const observe = openTelemetryObserver(tracer, {
      attributes: { "service.name": "storefront" },
    });

    observe(event("started"));
    observe(event("authorized"));
    observe(event("succeeded"));

    expect(tracer.startSpan).toHaveBeenCalledWith("webmcp cancel-order", {
      attributes: {
        "service.name": "storefront",
        "signet.invocation.id": "invocation-1",
        "signet.operation.name": "cancel-order",
      },
    });
    expect(span.addEvent).toHaveBeenNthCalledWith(1, "signet.authorized", {
      "signet.duration_ms": 12,
    });
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("records an application error and closes the failed span", () => {
    const { span, tracer } = harness();
    const observe = openTelemetryObserver(tracer);
    const failure = new Error("upstream failed");

    observe(event("started"));
    observe(event("failed", { error: failure }));

    expect(span.recordException).toHaveBeenCalledWith(failure);
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("handles a non-Error failure without inventing exception details", () => {
    const { span, tracer } = harness();
    const observe = openTelemetryObserver(tracer);

    observe(event("started"));
    observe(event("failed", { error: "failed" }));

    expect(span.recordException).not.toHaveBeenCalled();
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("ignores lifecycle events without a matching start", () => {
    const { tracer } = harness();
    const observe = openTelemetryObserver(tracer);

    expect(() => observe(event("succeeded"))).not.toThrow();
    expect(tracer.startSpan).not.toHaveBeenCalled();
  });

  it("supports a caller-owned span name without an operation name", () => {
    const { tracer } = harness();
    const observe = openTelemetryObserver(tracer, {
      spanName: ({ invocationId }) => `agent action ${invocationId}`,
    });

    observe({
      invocationId: "invocation-1",
      stage: "started",
      timestamp: 1,
      durationMs: 0,
    });

    expect(tracer.startSpan).toHaveBeenCalledWith(
      "agent action invocation-1",
      expect.objectContaining({
        attributes: { "signet.invocation.id": "invocation-1" },
      }),
    );
  });

  it("uses a generic tool span name when no operation name is available", () => {
    const { tracer } = harness();
    const observe = openTelemetryObserver(tracer);

    observe({
      invocationId: "invocation-1",
      stage: "started",
      timestamp: 1,
      durationMs: 0,
    });

    expect(tracer.startSpan).toHaveBeenCalledWith(
      "webmcp tool",
      expect.any(Object),
    );
  });
});
