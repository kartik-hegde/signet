import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.SIGNET_AGENT_DEMO_PORT ?? 4174);

createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    const payload = JSON.parse(await readBody(request));
    sendJson(response, demoCompletion(payload));
    return;
  }

  const path = request.url === "/" ? "index.html" : request.url.slice(1);
  if (!new Set(["index.html", "demo.mjs"]).has(path)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const body = await readFile(join(root, path));
  response.writeHead(200, {
    "content-type":
      extname(path) === ".mjs" ? "text/javascript" : "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}).listen(port, host, () => {
  console.log(`Signet Agent demo: http://${host}:${port}`);
  console.log(`Provider endpoint: http://${host}:${port}/v1/chat/completions`);
});

function demoCompletion(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const toolMessages = messages.filter((message) => message.role === "tool");
  const id = `demo_${toolMessages.length + 1}`;

  if (toolMessages.length === 0) {
    return choice({
      content: null,
      tool_calls: [call(id, "inspect_cart", {})],
    });
  }
  if (toolMessages.length === 1) {
    return choice({
      content: null,
      tool_calls: [call(id, "add_cart_item", { sku: "notebook", quantity: 2 })],
    });
  }
  return choice({
    content:
      "Added two notebooks. The page reports a $24.00 cart total, and the WebMCP call completed successfully.",
  });
}

function choice(message) {
  return {
    id: "signet-demo",
    choices: [{ index: 0, message: { role: "assistant", ...message } }],
  };
}

function call(id, name, args) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function sendJson(response, value) {
  response.writeHead(200, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}
