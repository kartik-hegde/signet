import { onMount } from "svelte";
import { writable, type Readable } from "svelte/store";

import type { SignetInterface, SignetTool } from "./interface.js";
import { bindSignetTool, type ToolBindingState } from "./lifecycle.js";

/** Exposes a tool after a Svelte component mounts and disposes it on teardown. */
export function useSignetTool<
  Context,
  Input extends Record<string, unknown>,
  Output,
>(
  signet: SignetInterface<Context>,
  tool: SignetTool<Input, Output, Context>,
): Readable<ToolBindingState> {
  const state = writable<ToolBindingState>({ status: "registering" });
  onMount(() => bindSignetTool(signet, tool, state.set));
  return { subscribe: state.subscribe };
}

export type { ToolBindingState } from "./lifecycle.js";
