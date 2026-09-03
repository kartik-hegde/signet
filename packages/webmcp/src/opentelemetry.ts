import {
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

import { describeError } from "./tracing.js";
import type { GuardEvent, GuardObserver } from "./types.js";

export {
  TraceAssembler,
  describeError,
  otlpObserver,
  toOtlpJson,
  type InvocationOutcome,
  type InvocationTrace,
  type OtlpJsonOptions,
  type OtlpObserver,
  type OtlpObserverOptions,
  type OtlpResource,
  type TraceError,
  type TraceLifecycleEvent,
  type TracePhase,
} from "./tracing.js";

export interface OpenTelemetryObserverOptions {
  readonly attributes?: Attributes;
  readonly spanName?: (event: GuardEvent) => string;
}

/** Maps Signett lifecycle events to standard OpenTelemetry spans. */
export function openTelemetryObserver(
  tracer: Tracer,
  options: OpenTelemetryObserverOptions = {},
): GuardObserver {
  const spans = new Map<string, Span>();

  return (event) => {
    if (event.stage === "started") {
      const span = tracer.startSpan(
        options.spanName?.(event) ?? `execute_tool ${event.name ?? "tool"}`,
        {
          attributes: {
            "gen_ai.operation.name": "execute_tool",
            ...(event.name === undefined
              ? {}
              : { "gen_ai.tool.name": event.name }),
            "gen_ai.tool.type": "function",
            "signett.invocation.id": event.invocationId,
            ...(event.name === undefined
              ? {}
              : { "signett.operation.name": event.name }),
            ...options.attributes,
          },
        },
      );
      spans.set(event.invocationId, span);
      return;
    }

    const span = spans.get(event.invocationId);
    if (!span) return;

    span.addEvent(`signett.${event.stage}`, {
      "signett.duration_ms": event.durationMs,
    });

    if (event.stage === "failed") {
      setErrorAttributes(span, event.error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      spans.delete(event.invocationId);
    } else if (event.stage === "outcome_unknown") {
      setErrorAttributes(span, event.error);
      span.setAttribute("signett.outcome", "unknown");
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      spans.delete(event.invocationId);
    } else if (event.stage === "succeeded") {
      span.setAttribute("signett.outcome", "succeeded");
      span.setStatus({ code: SpanStatusCode.UNSET });
      span.end();
      spans.delete(event.invocationId);
    }
  };
}

function setErrorAttributes(span: Span, error: unknown): void {
  const description = describeError(error);
  if (!description) return;
  span.setAttribute("error.type", description.type);
  if (description.code) span.setAttribute("error.code", description.code);
  if (description.retryable !== undefined) {
    span.setAttribute("error.retryable", description.retryable);
  }
}
