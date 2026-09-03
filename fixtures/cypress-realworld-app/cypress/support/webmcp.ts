/// <reference types="webmcp-types" />

export function installWebMcpCapture(
  win: Cypress.AUTWindow,
  mode: "raw" | "signett" = "signett"
) {
  const tools = new Map<string, WebMCP.ModelContextTool>();
  const target = new win.EventTarget();

  const modelContext: WebMCP.ModelContext = Object.assign(target, {
    ontoolchange: null,
    async registerTool(
      tool: WebMCP.ModelContextTool,
      options: WebMCP.ModelContextRegisterToolOptions = {}
    ) {
      tools.set(tool.name, tool);
      target.dispatchEvent(new win.Event("toolchange"));

      options.signal?.addEventListener(
        "abort",
        () => {
          if (tools.get(tool.name) === tool) {
            tools.delete(tool.name);
            target.dispatchEvent(new win.Event("toolchange"));
          }
        },
        { once: true }
      );
    },
    async getTools() {
      return [...tools.values()].map((tool) => ({
        name: tool.name,
        title: tool.title ?? tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        window: win,
        origin: win.location.origin,
      }));
    },
  });

  Object.defineProperty(win.document, "modelContext", {
    configurable: true,
    value: modelContext,
  });

  win.__webMcpBenchmarkMode = mode;

  win.__webMcpTest = {
    getToolNames: () => [...tools.keys()].sort(),
    executeTool: async (name, input, signal) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`WebMCP tool is not registered: ${name}`);
      const execution = signal ? { signal } : { signal: new win.AbortController().signal };
      return tool.execute(input, execution);
    },
    executeToolWithoutOptions: async (name, input) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`WebMCP tool is not registered: ${name}`);
      return (tool.execute as (input: Record<string, unknown>) => Promise<unknown>)(input);
    },
  };
}
