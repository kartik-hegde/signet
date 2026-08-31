import { useEffect, useState, type DependencyList } from "react";

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
  dependencies: DependencyList = [],
): ToolBindingState {
  const [state, setState] = useState<ToolBindingState>({
    status: "registering",
  });
  useEffect(
    () => bindSignetTool(signet, tool, setState),
    // The caller explicitly controls when a closure-backed tool is rebound.
    [signet, ...dependencies],
  );
  return state;
}

export type { ToolBindingState } from "./lifecycle.js";
