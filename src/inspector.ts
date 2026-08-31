import type { SignetInterface, SignetToolSnapshot } from "./interface.js";
import type { GuardEvent } from "./types.js";

export interface InspectorOptions {
  readonly target?: HTMLElement;
  readonly maxEvents?: number;
}

export interface SignetInspector {
  readonly element: HTMLElement;
  dispose(): void;
}

/** Mounts a local, metadata-only view of the tools and lifecycle an agent sees. */
export function mountSignetInspector<Context>(
  signet: SignetInterface<Context>,
  options: InspectorOptions = {},
): SignetInspector {
  if (typeof document === "undefined") {
    throw new Error("The Signet Inspector requires a browser document.");
  }
  const host = document.createElement("aside");
  host.dataset.signetInspector = "";
  const shadow = host.attachShadow({ mode: "open" });
  const events: GuardEvent[] = [];
  const maxEvents = options.maxEvents ?? 50;
  const render = (): void => {
    const openTools = new Set(
      Array.from(
        shadow.querySelectorAll<HTMLDetailsElement>("details[open]"),
        (details) => details.dataset.tool,
      ),
    );
    const scrollTop = host.scrollTop;
    shadow.innerHTML = `<style>${styles}</style><main><header>Signet</header>${renderTools(
      signet.tools(),
    )}<h2>Lifecycle</h2><ol>${events
      .map(
        (event) =>
          `<li><b>${escape(event.name ?? "registration")}</b> ${escape(event.stage)} <time>${event.durationMs.toFixed(1)}ms</time></li>`,
      )
      .join("")}</ol></main>`;
    for (const details of Array.from(
      shadow.querySelectorAll<HTMLDetailsElement>("details[data-tool]"),
    )) {
      details.open = openTools.has(details.dataset.tool);
    }
    host.scrollTop = scrollTop;
  };
  const stop = signet.observe((event) => {
    events.unshift(event);
    events.length = Math.min(events.length, maxEvents);
    render();
  });
  render();
  (options.target ?? document.body).append(host);
  return {
    element: host,
    dispose() {
      stop();
      host.remove();
    },
  };
}

function renderTools(tools: readonly SignetToolSnapshot[]): string {
  if (tools.length === 0) return "<p>No exposed tools.</p>";
  return tools
    .map(
      (tool) =>
        `<details data-tool="${escape(tool.name)}"><summary>${escape(tool.name)} <small>${escape(tool.status)}</small></summary><p>${escape(tool.description)}</p><pre>${escape(JSON.stringify({ inputSchema: tool.inputSchema, annotations: tool.annotations, exposedTo: tool.exposedTo }, null, 2))}</pre></details>`,
    )
    .join("");
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => entities[character] ?? character,
  );
}

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const styles = `:host{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(380px,calc(100vw - 24px));max-height:70vh;overflow:auto;color:#ece9e1;background:#171716;border:1px solid #444;border-radius:10px;font:13px/1.4 ui-monospace,monospace;box-shadow:0 12px 40px #0008}main{padding:12px}header{font:bold 16px system-ui;margin-bottom:8px}h2{font:600 12px system-ui;text-transform:uppercase;color:#aaa}details{border-top:1px solid #333;padding:7px 0}summary{cursor:pointer}small,time{float:right;color:#9b9}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#bbb}ol{list-style:none;padding:0;margin:0}li{padding:3px 0;border-top:1px solid #292929}`;
