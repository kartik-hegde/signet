import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type DependencyList,
} from "react";

import {
  createSignettActivityStore,
  type SignettActivityOptions,
  type SignettActivitySnapshot,
} from "./activity.js";
import type { SignettInterface, SignettTool } from "./interface.js";
import { bindSignettTool, type ToolBindingState } from "./lifecycle.js";

/** Exposes a tool for the lifetime of a React component. */
export function useSignettTool<
  Context,
  Input extends Record<string, unknown>,
  Output,
>(
  signett: SignettInterface<Context>,
  tool: SignettTool<Input, Output, Context>,
  dependencies: DependencyList,
): ToolBindingState {
  const [state, setState] = useState<ToolBindingState>({
    status: "registering",
  });
  useEffect(
    () => bindSignettTool(signett, tool, setState),
    // Requiring this list prevents silently freezing a first-render closure.
    [signett, ...dependencies],
  );
  return state;
}

/**
 * Projects tool calls into metadata-only state an application can render in its own UI.
 * It never mutates the DOM or replaces an authoritative application-state refresh.
 */
export function useSignettActivity<Context>(
  signett: SignettInterface<Context>,
  options: SignettActivityOptions = {},
): SignettActivitySnapshot {
  const { maxInvocations, toolName } = options;
  const [store] = useState(() =>
    createSignettActivityStore({
      ...(maxInvocations === undefined ? {} : { maxInvocations }),
      ...(toolName === undefined ? {} : { toolName }),
    }),
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const stopStore = store.subscribe(listener);
      const stopSignett = signett.observe(store.observe);
      return () => {
        stopSignett();
        stopStore();
      };
    },
    [signett, store],
  );

  return useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
}

export type { ToolBindingState } from "./lifecycle.js";
export type {
  SignettActivity,
  SignettActivityOptions,
  SignettActivityPhase,
  SignettActivityResolution,
  SignettActivitySnapshot,
} from "./activity.js";
