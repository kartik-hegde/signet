import type {
  SignettInterface,
  SignettRegistration,
  SignettTool,
} from "./interface.js";

export type ToolBindingState =
  | { readonly status: "registering" }
  | { readonly status: "registered" | "unsupported" }
  | { readonly status: "error"; readonly error: unknown };

const bindingQueues = new WeakMap<
  SignettInterface<unknown>,
  Map<string, Promise<void>>
>();

function queueFor(
  signett: SignettInterface<unknown>,
): Map<string, Promise<void>> {
  let queue = bindingQueues.get(signett);
  if (!queue) {
    queue = new Map<string, Promise<void>>();
    bindingQueues.set(signett, queue);
  }
  return queue;
}

/** Internal lifecycle shared by framework bindings. */
export function bindSignettTool<
  Context,
  Input extends Record<string, unknown>,
  Output,
>(
  signett: SignettInterface<Context>,
  tool: SignettTool<Input, Output, Context>,
  update: (state: ToolBindingState) => void,
): () => void {
  let active = true;
  let registration: SignettRegistration | undefined;
  update({ status: "registering" });
  const queue = queueFor(signett);
  const previous = queue.get(tool.name) ?? Promise.resolve();
  const pending = previous
    .catch(() => undefined)
    .then(async () => {
      if (!active) return;
      try {
        const created = await signett.expose(tool);
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
