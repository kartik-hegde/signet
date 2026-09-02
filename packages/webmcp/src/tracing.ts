import type {
  GuardEvent,
  GuardObserver,
  GuardStage,
  SignetCallerTelemetry,
} from "./types.js";

export interface TraceError {
  readonly type: string;
  readonly code?: string;
  readonly retryable?: boolean;
}

export interface TraceLifecycleEvent {
  readonly stage: GuardStage;
  readonly timestamp: number;
  readonly durationMs: number;
  readonly error?: TraceError;
}

export interface TracePhase {
  readonly name: string;
  readonly spanId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly status: "unset" | "error";
  readonly error?: TraceError;
}

export type InvocationOutcome =
  | "running"
  | "succeeded"
  | "replayed"
  | "recovered"
  | "denied"
  | "declined"
  | "cancelled"
  | "failed"
  | "unknown";

export interface InvocationTrace {
  readonly invocationId: string;
  readonly sequence: number;
  readonly name?: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceFlags: number;
  readonly tracestate?: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly outcome: InvocationOutcome;
  readonly resultSource?: "executed" | "replayed" | "recovered";
  readonly completedAfterAbort: boolean;
  readonly phases: readonly TracePhase[];
  readonly lifecycle: readonly TraceLifecycleEvent[];
  readonly error?: TraceError;
  readonly callerTelemetry?: SignetCallerTelemetry;
}

interface ActiveInvocation {
  invocationId: string;
  sequence: number;
  name?: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: number;
  tracestate?: string;
  startedAt: number;
  lastAt: number;
  lastBoundaryAt: number;
  lastStage: GuardStage;
  outcome: InvocationOutcome;
  resultSource?: InvocationTrace["resultSource"];
  completedAfterAbort: boolean;
  phases: TracePhase[];
  lifecycle: TraceLifecycleEvent[];
  error?: TraceError;
  callerTelemetry?: SignetCallerTelemetry;
}

export interface TraceAssemblerOptions {
  readonly maxInvocations?: number;
  readonly onComplete?: (trace: InvocationTrace) => void;
}

/** Reconstructs invocation and phase spans from Signet's metadata-only events. */
export class TraceAssembler {
  readonly #active = new Map<string, ActiveInvocation>();
  readonly #completed: InvocationTrace[] = [];
  readonly #maxInvocations: number;
  readonly #onComplete: ((trace: InvocationTrace) => void) | undefined;
  #nextSequence = 1;

  constructor(options: TraceAssemblerOptions = {}) {
    this.#maxInvocations = Math.max(1, options.maxInvocations ?? 50);
    this.#onComplete = options.onComplete;
  }

  observe(event: GuardEvent): InvocationTrace | undefined {
    if (event.stage === "started") {
      const callerTelemetry = normalizeCallerTelemetry(event.callerTelemetry);
      const parent = parseTraceparent(callerTelemetry?.traceparent);
      const startedAt = event.timestamp - event.durationMs;
      this.#active.set(event.invocationId, {
        invocationId: event.invocationId,
        sequence: callerTelemetry?.sequence ?? this.#nextSequence++,
        ...(event.name === undefined ? {} : { name: event.name }),
        traceId: parent?.traceId ?? randomHex(16),
        spanId: randomHex(8),
        ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
        traceFlags: parent?.traceFlags ?? 1,
        ...(callerTelemetry?.tracestate === undefined
          ? {}
          : { tracestate: callerTelemetry.tracestate }),
        startedAt,
        lastAt: event.timestamp,
        lastBoundaryAt: startedAt,
        lastStage: event.stage,
        outcome: "running",
        completedAfterAbort: false,
        phases: [],
        lifecycle: [],
        ...(callerTelemetry === undefined ? {} : { callerTelemetry }),
      });
    }

    const active = this.#active.get(event.invocationId);
    if (!active) return undefined;

    const error = describeError(event.error);
    active.lastAt = event.timestamp;
    active.lifecycle.push({
      stage: event.stage,
      timestamp: event.timestamp,
      durationMs: event.durationMs,
      ...(error === undefined ? {} : { error }),
    });
    if (event.stage === "completed_after_abort") {
      active.completedAfterAbort = true;
    }

    const phaseName = completedPhase(event.stage);
    if (phaseName) {
      addPhase(
        active,
        phaseName,
        event.timestamp,
        event.stage === "declined",
        error,
      );
    }

    if (!isTerminal(event.stage)) {
      active.lastStage = event.stage;
      return undefined;
    }

    if (event.stage !== "succeeded" && phaseName === undefined) {
      addPhase(
        active,
        failedPhase(active.lastStage),
        event.timestamp,
        true,
        error,
      );
    }

    if (error !== undefined) active.error = error;
    active.outcome = outcomeFor(active, event);
    const trace = snapshot(active, event.timestamp);
    this.#active.delete(event.invocationId);
    this.#completed.unshift(trace);
    this.#completed.length = Math.min(
      this.#completed.length,
      this.#maxInvocations,
    );
    this.#onComplete?.(trace);
    return trace;
  }

  snapshot(): readonly InvocationTrace[] {
    const running = [...this.#active.values()]
      .map((active) => snapshot(active, active.lastAt))
      .reverse();
    return [...running, ...this.#completed].slice(0, this.#maxInvocations);
  }
}

function addPhase(
  active: ActiveInvocation,
  name: string,
  endedAt: number,
  failed: boolean,
  error?: TraceError,
): void {
  const startedAt = Math.min(active.lastBoundaryAt, endedAt);
  active.phases.push({
    name,
    spanId: randomHex(8),
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    status: failed ? "error" : "unset",
    ...(error === undefined ? {} : { error }),
  });
  active.lastBoundaryAt = endedAt;
  if (name === "signet.execute") active.resultSource = "executed";
  if (name === "signet.replay") active.resultSource = "replayed";
  if (name === "signet.recover") active.resultSource = "recovered";
}

function completedPhase(stage: GuardStage): string | undefined {
  switch (stage) {
    case "validated":
      return "signet.validate";
    case "authorized":
      return "signet.authorize";
    case "confirmed":
    case "declined":
      return "signet.confirm";
    case "executed":
      return "signet.execute";
    case "replayed":
      return "signet.replay";
    case "recovered":
      return "signet.recover";
    case "output_validated":
    case "output_oversized":
    case "output_unmeasurable":
      return "signet.output";
    case "verified":
      return "signet.verify";
    default:
      return undefined;
  }
}

function failedPhase(stage: GuardStage): string {
  switch (stage) {
    case "started":
      return "signet.validate";
    case "confirmation_requested":
      return "signet.confirm";
    case "executed":
    case "replayed":
    case "recovered":
    case "output_validated":
    case "output_oversized":
    case "output_unmeasurable":
      return "signet.finalize";
    default:
      return "signet.execute";
  }
}

function isTerminal(stage: GuardStage): boolean {
  return (
    stage === "succeeded" || stage === "failed" || stage === "outcome_unknown"
  );
}

function outcomeFor(
  active: ActiveInvocation,
  event: GuardEvent,
): InvocationOutcome {
  if (event.stage === "outcome_unknown") return "unknown";
  if (event.stage === "succeeded") {
    if (active.resultSource === "replayed") return "replayed";
    if (active.resultSource === "recovered") return "recovered";
    return "succeeded";
  }
  if (active.lastStage === "declined") return "declined";
  const error = describeError(event.error);
  if (error?.code === "authorization_denied") return "denied";
  if (error?.code === "confirmation_declined") return "declined";
  if (error?.type === "AbortError") return "cancelled";
  return "failed";
}

function snapshot(active: ActiveInvocation, endedAt: number): InvocationTrace {
  return {
    invocationId: active.invocationId,
    sequence: active.sequence,
    ...(active.name === undefined ? {} : { name: active.name }),
    traceId: active.traceId,
    spanId: active.spanId,
    ...(active.parentSpanId === undefined
      ? {}
      : { parentSpanId: active.parentSpanId }),
    traceFlags: active.traceFlags,
    ...(active.tracestate === undefined
      ? {}
      : { tracestate: active.tracestate }),
    startedAt: active.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - active.startedAt),
    outcome: active.outcome,
    ...(active.resultSource === undefined
      ? {}
      : { resultSource: active.resultSource }),
    completedAfterAbort: active.completedAfterAbort,
    phases: [...active.phases],
    lifecycle: [...active.lifecycle],
    ...(active.error === undefined ? {} : { error: active.error }),
    ...(active.callerTelemetry === undefined
      ? {}
      : { callerTelemetry: active.callerTelemetry }),
  };
}

interface ErrorLike {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly retryable?: unknown;
}

/** Returns a bounded error classification without messages, stacks, or causes. */
export function describeError(error: unknown): TraceError | undefined {
  if (error === undefined) return undefined;
  if (typeof error !== "object" || error === null) {
    return { type: typeof error };
  }
  const value = error as ErrorLike;
  const type = bounded(value.name) ?? "Error";
  const code = bounded(value.code);
  const retryable =
    typeof value.retryable === "boolean" ? value.retryable : undefined;
  return {
    type,
    ...(code === undefined ? {} : { code }),
    ...(retryable === undefined ? {} : { retryable }),
  };
}

function normalizeCallerTelemetry(
  value: SignetCallerTelemetry | undefined,
): SignetCallerTelemetry | undefined {
  if (!value || value.version !== 1) return undefined;
  const agent = compact({
    id: bounded(value.agent?.id),
    name: bounded(value.agent?.name),
    version: bounded(value.agent?.version),
  });
  const model = compact({
    provider: bounded(value.model?.provider),
    name: bounded(value.model?.name),
  });
  const traceparent = parseTraceparent(value.traceparent)
    ? value.traceparent?.toLowerCase()
    : undefined;
  const tracestate = bounded(value.tracestate);
  const toolCallId = bounded(value.toolCallId);
  return {
    version: 1,
    ...(traceparent === undefined ? {} : { traceparent }),
    ...(tracestate === undefined ? {} : { tracestate }),
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(Number.isSafeInteger(value.sequence) &&
    value.sequence !== undefined &&
    value.sequence >= 0 &&
    value.sequence <= 2_147_483_647
      ? { sequence: value.sequence }
      : {}),
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
  };
}

function compact<Value extends Record<string, string | undefined>>(
  value: Value,
): Partial<Record<keyof Value, string>> | undefined {
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as Partial<Record<keyof Value, string>>);
}

function bounded(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const bytes = new TextEncoder().encode(trimmed);
  if (bytes.byteLength <= 128) return trimmed;
  return new TextDecoder().decode(bytes.slice(0, 128)).replace(/\uFFFD$/, "");
}

interface ParsedTraceparent {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

function parseTraceparent(
  value: string | undefined,
): ParsedTraceparent | undefined {
  const match =
    /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(
      value ?? "",
    );
  if (!match || match[1]?.toLowerCase() === "ff") return undefined;
  const traceId = match[2]?.toLowerCase();
  const spanId = match[3]?.toLowerCase();
  const flags = match[4];
  if (
    !traceId ||
    !spanId ||
    !flags ||
    /^0+$/.test(traceId) ||
    /^0+$/.test(spanId)
  ) {
    return undefined;
  }
  return { traceId, spanId, traceFlags: Number.parseInt(flags, 16) };
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return [...values]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

type AttributeValue = string | number | boolean;
export type OtlpResource = Readonly<Record<string, AttributeValue>>;

export interface OtlpJsonOptions {
  readonly resource?: OtlpResource;
  readonly serviceName?: string;
}

/** Encodes completed invocation traces as an OTLP/HTTP JSON request body. */
export function toOtlpJson(
  traces: readonly InvocationTrace[],
  options: OtlpJsonOptions = {},
): Record<string, unknown> {
  const resource = {
    "service.name": options.serviceName ?? "signet-webmcp",
    ...options.resource,
  };
  return {
    resourceSpans: [
      {
        resource: { attributes: attributes(resource) },
        scopeSpans: [
          {
            scope: { name: "@signet/webmcp", version: "0.0.0" },
            spans: traces.flatMap((trace) => [
              invocationSpan(trace),
              ...trace.phases.map((phase) => phaseSpan(trace, phase)),
            ]),
          },
        ],
      },
    ],
  };
}

function invocationSpan(trace: InvocationTrace): Record<string, unknown> {
  const caller = trace.callerTelemetry;
  const values: Record<string, AttributeValue | undefined> = {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": trace.name,
    "gen_ai.tool.type": "function",
    "gen_ai.tool.call.id": caller?.toolCallId,
    "gen_ai.agent.id": caller?.agent?.id,
    "gen_ai.agent.name": caller?.agent?.name,
    "signet.agent.version": caller?.agent?.version,
    "signet.caller.model.provider": caller?.model?.provider,
    "signet.caller.model.name": caller?.model?.name,
    "signet.invocation.id": trace.invocationId,
    "signet.invocation.sequence": trace.sequence,
    "signet.outcome": trace.outcome,
    "signet.result_source": trace.resultSource,
    "signet.completed_after_abort": trace.completedAfterAbort,
    "error.type": trace.error?.type,
    "error.code": trace.error?.code,
    "error.retryable": trace.error?.retryable,
  };
  return {
    traceId: trace.traceId,
    spanId: trace.spanId,
    ...(trace.parentSpanId === undefined
      ? {}
      : { parentSpanId: trace.parentSpanId }),
    traceState: trace.tracestate ?? "",
    flags: trace.traceFlags,
    name: `execute_tool ${trace.name ?? "tool"}`,
    kind: 1,
    startTimeUnixNano: nanos(trace.startedAt),
    endTimeUnixNano: nanos(trace.endedAt),
    attributes: attributes(values),
    events: trace.lifecycle.map((event) => ({
      timeUnixNano: nanos(event.timestamp),
      name: `signet.${event.stage}`,
      attributes: attributes({ "signet.duration_ms": event.durationMs }),
    })),
    status: {
      code:
        trace.outcome === "succeeded" ||
        trace.outcome === "replayed" ||
        trace.outcome === "recovered"
          ? 0
          : 2,
    },
  };
}

function phaseSpan(
  trace: InvocationTrace,
  phase: TracePhase,
): Record<string, unknown> {
  return {
    traceId: trace.traceId,
    spanId: phase.spanId,
    parentSpanId: trace.spanId,
    traceState: trace.tracestate ?? "",
    flags: trace.traceFlags,
    name: phase.name,
    kind: 1,
    startTimeUnixNano: nanos(phase.startedAt),
    endTimeUnixNano: nanos(phase.endedAt),
    attributes: attributes({
      "signet.duration_ms": phase.durationMs,
      "error.type": phase.error?.type,
      "error.code": phase.error?.code,
    }),
    status: { code: phase.status === "error" ? 2 : 0 },
  };
}

function attributes(
  values: Readonly<Record<string, AttributeValue | undefined>>,
): readonly Record<string, unknown>[] {
  return Object.entries(values).flatMap(([key, value]) => {
    if (value === undefined) return [];
    const encoded =
      typeof value === "string"
        ? { stringValue: value }
        : typeof value === "boolean"
          ? { boolValue: value }
          : Number.isInteger(value)
            ? { intValue: String(value) }
            : { doubleValue: value };
    return [{ key, value: encoded }];
  });
}

function nanos(milliseconds: number): string {
  return BigInt(Math.round(milliseconds * 1_000_000)).toString();
}

export interface OtlpObserverOptions extends OtlpJsonOptions {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly flushIntervalMs?: number;
  readonly maxQueue?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface OtlpObserver extends GuardObserver {
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/** A dependency-free OTLP/HTTP JSON exporter. Export failures never affect tools. */
export function otlpObserver(options: OtlpObserverOptions): OtlpObserver {
  const queue: InvocationTrace[] = [];
  const maxQueue = Math.max(1, options.maxQueue ?? 100);
  const interval = Math.max(0, options.flushIntervalMs ?? 1_000);
  const send = options.fetch ?? globalThis.fetch;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let exporting: Promise<void> | undefined;

  const schedule = (): void => {
    if (timer !== undefined || stopped || queue.length === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, interval);
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  const assembler = new TraceAssembler({
    maxInvocations: maxQueue,
    onComplete(trace) {
      queue.push(trace);
      if (queue.length > maxQueue) queue.shift();
      if (queue.length >= maxQueue) void flush();
      else schedule();
    },
  });

  const flush = async (): Promise<void> => {
    if (exporting) return await exporting;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const batch = queue.splice(0);
    if (batch.length === 0 || typeof send !== "function") return;
    exporting = (async () => {
      try {
        await send(options.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...options.headers,
          },
          body: JSON.stringify(toOtlpJson(batch, options)),
          keepalive: true,
        });
      } catch {
        // Telemetry is never part of the application's success path.
      } finally {
        exporting = undefined;
        schedule();
      }
    })();
    await exporting;
  };

  const observer = Object.assign(
    (event: GuardEvent): void => {
      if (!stopped) assembler.observe(event);
    },
    {
      flush,
      async shutdown(): Promise<void> {
        stopped = true;
        globalThis.removeEventListener?.("pagehide", pagehide);
        await flush();
      },
    },
  );
  const pagehide = (): void => {
    void flush();
  };
  globalThis.addEventListener?.("pagehide", pagehide);
  return observer;
}
