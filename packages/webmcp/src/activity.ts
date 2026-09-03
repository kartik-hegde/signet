import type { SignettInterface } from "./interface.js";
import type { GuardEvent, GuardObserver, GuardStage } from "./types.js";

export type SignettActivityPhase =
  | "running"
  | "awaiting_confirmation"
  | "verifying"
  | "succeeded"
  | "declined"
  | "failed"
  | "unknown";

export type SignettActivityResolution = "executed" | "replayed" | "recovered";

/** Metadata-only UI state for one tool invocation. */
export interface SignettActivity {
  readonly invocationId: string;
  readonly name: string;
  readonly phase: SignettActivityPhase;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly durationMs: number;
  /** True only when the tool's application-owned `verify` hook passed. */
  readonly verified: boolean;
  readonly resolution: SignettActivityResolution | undefined;
}

export interface SignettActivitySnapshot {
  /** Invocations ordered by when the feed first observes them, newest first. */
  readonly invocations: readonly SignettActivity[];
  /** The most recently first-observed invocation, not the most recently updated one. */
  readonly latest: SignettActivity | undefined;
}

export interface SignettActivityOptions {
  /** Retain only this tool's invocations. */
  readonly toolName?: string;
  /** Maximum retained invocations. Defaults to 20. */
  readonly maxInvocations?: number;
}

export interface SignettActivityFeed {
  getSnapshot(this: void): SignettActivitySnapshot;
  subscribe(this: void, listener: () => void): () => void;
  dispose(this: void): void;
}

interface SignettActivityStore {
  readonly observe: GuardObserver;
  getSnapshot(this: void): SignettActivitySnapshot;
  subscribe(this: void, listener: () => void): () => void;
}

const registrationStages = new Set<GuardStage>([
  "registering",
  "registered",
  "unsupported",
  "registration_failed",
  "unregistered",
]);

function phaseFor(
  stage: GuardStage,
  previous: SignettActivityPhase | undefined,
): SignettActivityPhase {
  if (stage === "confirmation_requested") return "awaiting_confirmation";
  if (stage === "declined") return "declined";
  if (stage === "failed" && previous === "declined") return "declined";
  if (stage === "failed") return "failed";
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
  previous: SignettActivityResolution | undefined,
): SignettActivityResolution | undefined {
  if (stage === "executed") return "executed";
  if (stage === "replayed") return "replayed";
  if (stage === "recovered") return "recovered";
  return previous;
}

function validateOptions(options: SignettActivityOptions): number {
  const maxInvocations = options.maxInvocations ?? 20;
  if (!Number.isSafeInteger(maxInvocations) || maxInvocations <= 0) {
    throw new TypeError("maxInvocations must be a positive integer.");
  }
  if (options.toolName !== undefined && options.toolName.length === 0) {
    throw new TypeError("toolName must not be empty.");
  }
  return maxInvocations;
}

export function createSignettActivityStore(
  options: SignettActivityOptions = {},
): SignettActivityStore {
  const maxInvocations = validateOptions(options);
  const activities = new Map<string, SignettActivity>();
  const order: string[] = [];
  const listeners = new Set<() => void>();
  let snapshot: SignettActivitySnapshot = {
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

      const activity: SignettActivity = {
        invocationId: event.invocationId,
        name: event.name,
        phase: phaseFor(event.stage, previous?.phase),
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
 * Projects privacy-safe Signett lifecycle events into state suitable for application UI.
 * The feed is best-effort presentation state, not authorization or business state.
 */
export function createSignettActivity<Context>(
  signett: SignettInterface<Context>,
  options: SignettActivityOptions = {},
): SignettActivityFeed {
  const store = createSignettActivityStore(options);
  const stop = signett.observe(store.observe);
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
