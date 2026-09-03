import { useEffect, useMemo } from "react";

import { createSignett } from "signett";
import { mountSignettInspector } from "signett/inspector";
import { useSignettTool } from "signett/react";

import { greetingTool } from "./greeting";

export function App() {
  const signett = useMemo(() => {
    const exportToJaeger = new URLSearchParams(location.search).has("otlp");
    return createSignett({
      unsupported: "warn",
      ...(exportToJaeger
        ? {
            telemetry: {
              otlp: "/v1/traces",
              serviceName: "signett-hello-world",
            },
          }
        : {}),
    });
  }, []);
  const registration = useSignettTool(signett, greetingTool, [greetingTool]);

  useEffect(() => {
    const inspector = mountSignettInspector(signett);
    return () => inspector.dispose();
  }, [signett]);

  return (
    <main className="shell">
      <p className="eyebrow">Signett codelab 01</p>
      <h1>Hello from a browser tool.</h1>
      <p className="lede">
        This React page exposes one read-only WebMCP tool. Ask a connected
        browser agent to call <code>get_greeting</code> with an empty object.
      </p>

      <section className="tool-card" aria-labelledby="tool-heading">
        <div>
          <p className="label">Exposed tool</p>
          <h2 id="tool-heading">get_greeting</h2>
        </div>
        <span className={`status status-${registration.status}`}>
          {registration.status}
        </span>
        {registration.status === "error" ? (
          <p className="error">
            {registration.error instanceof Error
              ? registration.error.message
              : "Tool registration failed."}
          </p>
        ) : null}
      </section>

      <ol className="steps">
        <li>Open Chrome DevTools and inspect Application → WebMCP.</li>
        <li>
          Execute the tool there, or ask an MCP-connected agent to call it.
        </li>
        <li>Watch the Signett panel show the call and its latency waterfall.</li>
      </ol>

      <pre className="result" aria-label="Expected tool result">
        {JSON.stringify({ message: "Hello, world!" }, null, 2)}
      </pre>
    </main>
  );
}
