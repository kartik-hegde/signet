import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type DependencyList,
} from "react";

import {
  createSignetActivityStore,
  type SignetActivityOptions,
  type SignetActivitySnapshot,
} from "./activity.js";
import type { SignetInterface, SignetTool } from "./interface.js";
import { bindSignetTool, type ToolBindingState } from "./lifecycle.js";

/** Exposes a tool for the lifetime of a React component. */
export function useSignetTool<
  Context,
  Input extends Record<string, unknown>,
  Output,
>(
  signet: SignetInterface<Context>,
  tool: SignetTool<Input, Output, Context>,
  dependencies: DependencyList,
): ToolBindingState {
  const [state, setState] = useState<ToolBindingState>({
    status: "registering",
  });
  useEffect(
    () => bindSignetTool(signet, tool, setState),
    // Requiring this list prevents silently freezing a first-render closure.
    [signet, ...dependencies],
  );
  return state;
}

/**
 * Projects tool calls into metadata-only state an application can render in its own UI.
 * It never mutates the DOM or replaces an authoritative application-state refresh.
 */
export function useSignetActivity<Context>(
  signet: SignetInterface<Context>,
  options: SignetActivityOptions = {},
): SignetActivitySnapshot {
  const { maxInvocations, toolName } = options;
  const store = useMemo(
    () =>
      createSignetActivityStore({
        ...(maxInvocations === undefined ? {} : { maxInvocations }),
        ...(toolName === undefined ? {} : { toolName }),
      }),
    [maxInvocations, signet, toolName],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const stopStore = store.subscribe(listener);
      const stopSignet = signet.observe(store.observe);
      return () => {
        stopSignet();
        stopStore();
      };
    },
    [signet, store],
  );

  return useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
}

export type { ToolBindingState } from "./lifecycle.js";
export type {
  SignetActivity,
  SignetActivityOptions,
  SignetActivityPhase,
  SignetActivityResolution,
  SignetActivitySnapshot,
} from "./activity.js";
