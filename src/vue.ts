import { onMounted, onScopeDispose, shallowRef, type ShallowRef } from "vue";

import type { SignetInterface, SignetTool } from "./interface.js";
import { bindSignetTool, type ToolBindingState } from "./lifecycle.js";

/** Exposes a tool for the lifetime of the current Vue effect scope. */
export function useSignetTool<
  Context,
  Input extends Record<string, unknown>,
  Output,
>(
  signet: SignetInterface<Context>,
  tool: SignetTool<Input, Output, Context>,
): ShallowRef<ToolBindingState> {
  const state = shallowRef<ToolBindingState>({ status: "registering" });
  let dispose: (() => void) | undefined;
  onMounted(() => {
    dispose = bindSignetTool(signet, tool, (next) => {
      state.value = next;
    });
  });
  onScopeDispose(() => dispose?.());
  return state;
}

export type { ToolBindingState } from "./lifecycle.js";
