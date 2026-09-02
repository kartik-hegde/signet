import type { SignetTool } from "@signet/webmcp";

export const greetingTool: SignetTool<
  Record<string, never>,
  { message: string },
  undefined
> = {
  name: "get_greeting",
  description: "Return a greeting from this website.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  // A small delay makes the execution phase visible in the tutorial waterfall.
  execute: async () => {
    await new Promise((resolve) => setTimeout(resolve, 75));
    return { message: "Hello, world!" };
  },
};
