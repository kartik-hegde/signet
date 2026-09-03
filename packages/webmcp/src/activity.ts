import type { SignetInterface } from "./interface.js";
import type { GuardEvent, GuardObserver, GuardStage } from "./types.js";

export type SignetActivityPhase =
  | "running"
  | "awaiting_confirmation"
  | "verifying"
  | "succeeded"
  | "failed"
  | "unknown";

export type SignetActivityResolution = "executed" | "replayed" | "recovered";

/** Metadata-only UI state for one tool invocation. */
export interface SignetActivity {
  readonly invocationId: string;
  readonly name: string;
  readonly phase: SignetActivityPhase;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly durationMs: number;
  /** True only when the tool's application-owned `verify` hook passed. */
  readonly verified: boolean;
  readonly resolution: SignetActivityResolution | undefined;
}

export interface SignetActivitySnapshot {
  /** Invocations ordered by when the feed first observed them, newest first. */
  readonly invocations: readonly SignetActivity[];
  readonly latest: SignetActivity | undefined;
}

export interface SignetActivityOptions {
  /** Retain only this tool's invocations. */
  readonly toolName?: string;
  /** Maximum retained invocations. Defaults to 20. */
  readonly maxInvocations?: number;
}

export interface SignetActivityFeed {
  getSnapshot(this: void): SignetActivitySnapshot;
  subscribe(this: void, listener: () => void): () => void;
  dispose(this: void): void;
}

interface SignetActivityStore {
  readonly observe: GuardObserver;
  getSnapshot(this: void): SignetActivitySnapshot;
  subscribe(this: void, listener: () => void): () => void;
}

const registrationStages = new Set<GuardStage>([
  "registering",
  "registered",
  "unsupported",
  "registration_failed",
  "unregistered",
]);

function phaseFor(stage: GuardStage): SignetActivityPhase {
  if (stage === "confirmation_requested") return "awaiting_confirmation";
  if (stage === "declined" || stage === "failed") return "failed";
  if (stage === "outcome_unknown") return "unknown";
  if (stage === "succeeded") return "succeeded";
  if (
    stage === "executed" ||
    stage === "replayed" ||
    stage === "recovered" ||
    stage === "output_validated" ||
    stage === "output_oversized" ||
    stage === "output_unmeasurable" ||
    stage === "completed_after_abort" ||
    stage === "verified"
  ) {
    return "verifying";
  }
  return "running";
}

function resolutionFor(
  stage: GuardStage,
  previous: SignetActivityResolution | undefined,
): SignetActivityResolution | undefined {
  if (stage === "executed") return "executed";
  if (stage === "replayed") return "replayed";
  if (stage === "recovered") return "recovered";
  return previous;
}

function validateOptions(options: SignetActivityOptions): number {
  const maxInvocations = options.maxInvocations ?? 20;
  if (!Number.isSafeInteger(maxInvocations) || maxInvocations <= 0) {
    throw new TypeError("maxInvocations must be a positive integer.");
  }
  if (options.toolName !== undefined && options.toolName.length === 0) {
    throw new TypeError("toolName must not be empty.");
  }
  return maxInvocations;
}

export function createSignetActivityStore(
  options: SignetActivityOptions = {},
): SignetActivityStore {
  const maxInvocations = validateOptions(options);
  const activities = new Map<string, SignetActivity>();
  const order: string[] = [];
  const listeners = new Set<() => void>();
  let snapshot: SignetActivitySnapshot = {
    invocations: [],
    latest: undefined,
  };

  const publish = (): void => {
    const invocations = order.flatMap((id) => {
      const activity = activities.get(id);
      return activity ? [activity] : [];
    });
    snapshot = { invocations, latest: invocations[0] };
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Presentation subscribers never alter tool execution.
      }
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    observe(event: GuardEvent) {
      if (
        registrationStages.has(event.stage) ||
        event.name === undefined ||
        (options.toolName !== undefined && event.name !== options.toolName)
      ) {
        return;
      }

      const previous = activities.get(event.invocationId);
      if (!previous) {
        order.unshift(event.invocationId);
        while (order.length > maxInvocations) {
          const removed = order.pop();
          if (removed !== undefined) activities.delete(removed);
        }
      }

      const activity: SignetActivity = {
        invocationId: event.invocationId,
        name: event.name,
        phase: phaseFor(event.stage),
        startedAt:
          previous?.startedAt ??
          Math.max(0, event.timestamp - Math.max(0, event.durationMs)),
        updatedAt: event.timestamp,
        durationMs: Math.max(0, event.durationMs),
        verified: previous?.verified === true || event.stage === "verified",
        resolution: resolutionFor(event.stage, previous?.resolution),
      };
      activities.set(event.invocationId, activity);
      publish();
    },
  };
}

/**
 * Projects privacy-safe Signet lifecycle events into state suitable for application UI.
 * The feed is best-effort presentation state, not authorization or business state.
 */
export function createSignetActivity<Context>(
  signet: SignetInterface<Context>,
  options: SignetActivityOptions = {},
): SignetActivityFeed {
  const store = createSignetActivityStore(options);
  const stop = signet.observe(store.observe);
  let disposed = false;

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
    },
  };
}
