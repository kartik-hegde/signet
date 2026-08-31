import type {
  SignetInterface,
  SignetRegistration,
  SignetTool,
} from "./interface.js";

export type ToolBindingState =
  | { readonly status: "registering" }
  | { readonly status: "registered" | "unsupported" }
  | { readonly status: "error"; readonly error: unknown };

/** Internal lifecycle shared by framework bindings. */
export function bindSignetTool<
  Context,
  Input extends Record<string, unknown>,
  Output,
>(
  signet: SignetInterface<Context>,
  tool: SignetTool<Input, Output, Context>,
  update: (state: ToolBindingState) => void,
): () => void {
  let active = true;
  let registration: SignetRegistration | undefined;
  update({ status: "registering" });
  void signet.expose(tool).then(
    (created) => {
      if (!active) {
        created.dispose();
        return;
      }
      registration = created;
      const status = created.status;
      if (status !== "disposed") update({ status });
    },
    (error: unknown) => {
      if (active) update({ status: "error", error });
    },
  );

  return () => {
    active = false;
    registration?.dispose();
  };
}
