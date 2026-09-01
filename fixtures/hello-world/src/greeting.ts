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
  execute: () => ({ message: "Hello, world!" }),
};
