import type {
  SignetInterface,
  SignetRegistration,
  SignetTool,
} from "./interface.js";

export type ToolBindingState =
  | { readonly status: "registering" }
  | { readonly status: "registered" | "unsupported" }
  | { readonly status: "error"; readonly error: unknown };

const bindingQueues = new WeakMap<
  SignetInterface<unknown>,
  Map<string, Promise<void>>
>();

function queueFor(
  signet: SignetInterface<unknown>,
): Map<string, Promise<void>> {
  let queue = bindingQueues.get(signet);
  if (!queue) {
    queue = new Map<string, Promise<void>>();
    bindingQueues.set(signet, queue);
  }
  return queue;
}

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
  const queue = queueFor(signet);
  const previous = queue.get(tool.name) ?? Promise.resolve();
  const pending = previous
    .catch(() => undefined)
    .then(async () => {
      if (!active) return;
      try {
        const created = await signet.expose(tool);
        if (!active) {
          created.dispose();
          return;
        }
        registration = created;
        const status = created.status;
        if (status !== "disposed") update({ status });
      } catch (error) {
        if (active) update({ status: "error", error });
      }
    });
  queue.set(tool.name, pending);
  const releaseQueue = (): void => {
    if (queue.get(tool.name) === pending) queue.delete(tool.name);
  };
  void pending.then(releaseQueue, releaseQueue);

  return () => {
    active = false;
    registration?.dispose();
  };
}
