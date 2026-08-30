import {
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

import type { GuardEvent, GuardObserver } from "./types.js";

export interface OpenTelemetryObserverOptions {
  readonly attributes?: Attributes;
  readonly spanName?: (event: GuardEvent) => string;
}

/** Maps Signet lifecycle events to standard OpenTelemetry spans. */
export function openTelemetryObserver(
  tracer: Tracer,
  options: OpenTelemetryObserverOptions = {},
): GuardObserver {
  const spans = new Map<string, Span>();

  return (event) => {
    if (event.stage === "started") {
      const span = tracer.startSpan(
        options.spanName?.(event) ?? `webmcp ${event.name ?? "tool"}`,
        {
          attributes: {
            "signet.invocation.id": event.invocationId,
            ...(event.name === undefined
              ? {}
              : { "signet.operation.name": event.name }),
            ...options.attributes,
          },
        },
      );
      spans.set(event.invocationId, span);
      return;
    }

    const span = spans.get(event.invocationId);
    if (!span) return;

    span.addEvent(`signet.${event.stage}`, {
      "signet.duration_ms": event.durationMs,
    });

    if (event.stage === "failed") {
      if (event.error instanceof Error) span.recordException(event.error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      spans.delete(event.invocationId);
    } else if (event.stage === "succeeded") {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      spans.delete(event.invocationId);
    }
  };
}
