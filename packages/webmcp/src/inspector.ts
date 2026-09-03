import type { SignettInterface, SignettToolSnapshot } from "./interface.js";
import {
  TraceAssembler,
  type InvocationTrace,
  type TracePhase,
} from "./tracing.js";

export interface InspectorOptions {
  readonly target?: HTMLElement;
  /** @deprecated Use `maxInvocations`. */
  readonly maxEvents?: number;
  readonly maxInvocations?: number;
  /** Also expose completed calls in the browser Performance panel. */
  readonly userTiming?: boolean;
}

export interface SignettInspector {
  readonly element: HTMLElement;
  dispose(): void;
}

/** Mounts a local, metadata-only waterfall of tools, calls, phases, and errors. */
export function mountSignettInspector<Context>(
  signett: SignettInterface<Context>,
  options: InspectorOptions = {},
): SignettInspector {
  if (typeof document === "undefined") {
    throw new Error("The Signett Inspector requires a browser document.");
  }
  const host = document.createElement("aside");
  host.dataset.signettInspector = "";
  const shadow = host.attachShadow({ mode: "open" });
  const assembler = new TraceAssembler({
    maxInvocations: options.maxInvocations ?? options.maxEvents ?? 50,
    ...(options.userTiming === false ? {} : { onComplete: exposeUserTiming }),
  });

  const render = (): void => {
    const open = new Set(
      Array.from(
        shadow.querySelectorAll<HTMLDetailsElement>("details[open]"),
        (details) => details.dataset.key,
      ),
    );
    const scrollTop = host.scrollTop;
    shadow.innerHTML = `<style>${styles}</style><main><header><span class="pulse"></span>Signett Inspector</header>${renderTools(
      signett.tools(),
    )}<h2>Calls</h2>${renderCalls(assembler.snapshot())}</main>`;
    for (const details of Array.from(
      shadow.querySelectorAll<HTMLDetailsElement>("details[data-key]"),
    )) {
      details.open = open.has(details.dataset.key);
    }
    host.scrollTop = scrollTop;
  };

  const stop = signett.observe((event) => {
    assembler.observe(event);
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

function renderTools(tools: readonly SignettToolSnapshot[]): string {
  if (tools.length === 0) return "<p class=empty>No exposed tools.</p>";
  return `<section class=tools>${tools
    .map(
      (tool) =>
        `<details data-key="tool:${escape(tool.name)}"><summary>${escape(tool.name)} <small>${escape(tool.status)}</small></summary><p>${escape(tool.description)}</p><pre>${escape(JSON.stringify({ inputSchema: tool.inputSchema, annotations: tool.annotations, exposedTo: tool.exposedTo }, null, 2))}</pre></details>`,
    )
    .join("")}</section>`;
}

function renderCalls(traces: readonly InvocationTrace[]): string {
  if (traces.length === 0) {
    return "<p class=empty>Call an exposed tool to see its trace.</p>";
  }
  return `<section class=calls>${traces.map(renderCall).join("")}</section>`;
}

function renderCall(trace: InvocationTrace): string {
  const duration = Math.max(trace.durationMs, 0.01);
  const caller = trace.callerTelemetry;
  const context = [
    caller?.agent?.name,
    caller?.model?.provider && caller.model.name
      ? `${caller.model.provider}/${caller.model.name}`
      : caller?.model?.name,
  ]
    .filter(Boolean)
    .map((value) => escape(String(value)))
    .join(" · ");
  return `<details class="call ${escape(trace.outcome)}" data-key="call:${escape(trace.invocationId)}"><summary><span class=seq>#${trace.sequence}</span><b>${escape(trace.name ?? "tool")}</b><span class="outcome">${escape(trace.outcome)}</span><time>${formatDuration(trace.durationMs)}</time></summary>${context ? `<p class=context>${context}</p>` : ""}<div class=timeline aria-label="${escape(`${trace.name ?? "tool"}, ${formatDuration(trace.durationMs)}`)}">${trace.phases.map((phase) => renderPhaseBar(phase, trace.startedAt, duration)).join("")}</div><ol class=phases>${trace.phases.map(renderPhase).join("")}</ol><p class=ids>trace ${escape(trace.traceId)}<br>span ${escape(trace.spanId)}${caller?.toolCallId ? `<br>tool call ${escape(caller.toolCallId)}` : ""}</p></details>`;
}

function renderPhaseBar(
  phase: TracePhase,
  traceStartedAt: number,
  traceDuration: number,
): string {
  const left = Math.max(
    0,
    Math.min(100, ((phase.startedAt - traceStartedAt) / traceDuration) * 100),
  );
  const width = Math.max(
    1,
    Math.min(100 - left, (phase.durationMs / traceDuration) * 100),
  );
  return `<span class="bar ${phase.status}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${escape(`${shortPhase(phase.name)} ${formatDuration(phase.durationMs)}`)}"></span>`;
}

function renderPhase(phase: TracePhase): string {
  return `<li class=${phase.status}><span>${escape(shortPhase(phase.name))}</span><time>${formatDuration(phase.durationMs)}</time>${phase.error ? `<small>${escape(phase.error.code ?? phase.error.type)}</small>` : ""}</li>`;
}

function shortPhase(name: string): string {
  return name.startsWith("signett.") ? name.slice(7) : name;
}

function formatDuration(durationMs: number): string {
  return durationMs >= 1_000
    ? `${(durationMs / 1_000).toFixed(2)}s`
    : `${durationMs.toFixed(1)}ms`;
}

function exposeUserTiming(trace: InvocationTrace): void {
  try {
    if (typeof performance === "undefined" || !performance.measure) return;
    const origin = performance.timeOrigin ?? Date.now() - performance.now();
    performance.measure(`Signett: ${trace.name ?? "tool"} #${trace.sequence}`, {
      start: Math.max(0, trace.startedAt - origin),
      duration: trace.durationMs,
      detail: {
        invocationId: trace.invocationId,
        traceId: trace.traceId,
        outcome: trace.outcome,
      },
    });
  } catch {
    // User Timing support varies; the inspector remains fully functional.
  }
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

const styles = `:host{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(430px,calc(100vw - 24px));max-height:76vh;overflow:auto;color:#ece9e1;background:#171716;border:1px solid #444;border-radius:12px;font:12px/1.45 ui-monospace,SFMono-Regular,monospace;box-shadow:0 16px 48px #0009}main{padding:14px}header{font:700 16px system-ui;margin-bottom:10px}.pulse{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:#70d99b;box-shadow:0 0 10px #70d99b}h2{margin:14px 0 6px;font:650 11px system-ui;letter-spacing:.08em;text-transform:uppercase;color:#999}.empty{color:#92928d}.tools details,.call{border-top:1px solid #30302e;padding:7px 0}summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}summary:before{content:'›';display:inline-block;width:12px;color:#777}details[open]>summary:before{transform:rotate(90deg)}small,time{color:#aaa}summary small{float:right}.call summary{display:grid;grid-template-columns:28px 1fr auto auto;gap:7px;align-items:center}.call summary:before{display:none}.seq{color:#777}.outcome{border-radius:9px;padding:1px 6px;background:#333;color:#bbb}.succeeded .outcome,.replayed .outcome,.recovered .outcome{background:#183a29;color:#8de5ad}.failed .outcome,.denied .outcome,.declined .outcome,.unknown .outcome{background:#48201f;color:#ffaaa3}.running .outcome{background:#27354a;color:#9ac3ff}.timeline{position:relative;height:11px;margin:9px 0 7px;background:#292927;border-radius:6px;overflow:hidden}.bar{position:absolute;top:0;height:100%;background:#70a9e8;border-right:1px solid #171716}.bar:nth-child(2n){background:#91d6b4}.bar.error{background:#ed756b}.phases{list-style:none;padding:0;margin:0}.phases li{display:grid;grid-template-columns:10px 1fr auto auto;gap:8px;padding:2px 0;color:#bbb}.phases li:before{content:'·';color:#70a9e8}.phases li.error:before{color:#ed756b}.context,.ids{margin:7px 0;color:#8f8f89}.ids{font-size:10px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#bbb}p{margin:7px 0}`;
