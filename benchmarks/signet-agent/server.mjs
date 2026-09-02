import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const benchmarkRoot = resolve(import.meta.dirname);
const repositoryRoot = resolve(benchmarkRoot, "../..");
const fixtureRoot = join(benchmarkRoot, "fixture");
const signetRoot = join(repositoryRoot, "packages/webmcp/dist");
const schemaRoot = join(
  repositoryRoot,
  "node_modules/@cfworker/json-schema/dist/esm",
);

export async function startFixtureServer({ port = 0 } = {}) {
  let state = baselineState();
  const lostResponses = new Set();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture.local");
      if (request.method === "POST" && url.pathname === "/api/reset") {
        state = baselineState();
        lostResponses.clear();
        return json(response, 200, state);
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        return json(response, 200, state);
      }
      if (request.method === "POST" && url.pathname === "/api/action") {
        const { action, input = {} } = await readJson(request);
        const result = applyAction(state, action, input);
        if (
          action === "create_article" &&
          input.clientToken.startsWith("lost-") &&
          !lostResponses.has(input.clientToken)
        ) {
          lostResponses.add(input.clientToken);
          return json(response, 503, {
            code: "response_lost",
            message:
              "The server committed the article but its response was lost.",
            retryable: true,
          });
        }
        return json(response, 200, result);
      }
      const file = resolveAsset(url.pathname);
      if (!file || !existsSync(file)) {
        return json(response, 404, { message: "Not found." });
      }
      response.writeHead(200, {
        "content-type": contentType(file),
        "cache-control": "no-store",
      });
      createReadStream(file).pipe(response);
    } catch (error) {
      json(response, error.status ?? 500, {
        code: error.code ?? "fixture_error",
        message: error.message ?? String(error),
      });
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

export function baselineState() {
  return {
    products: [
      { id: "p-notebook", name: "Grid Notebook", price: 6, stock: 20 },
      { id: "p-planner", name: "Weekly Planner", price: 14, stock: 8 },
      { id: "p-pen", name: "Blue Pen", price: 3, stock: 50 },
    ],
    cart: {},
    orders: {
      "ord-100": { id: "ord-100", status: "pending", total: 42 },
      "ord-200": { id: "ord-200", status: "shipped", total: 19 },
    },
    issues: {
      101: {
        id: 101,
        title: "Checkout timeout",
        assignee: "maya",
        status: "open",
        labels: ["bug"],
        comments: [],
        restricted: false,
      },
      102: {
        id: 102,
        title: "Security incident details",
        assignee: "maya",
        status: "open",
        labels: ["security"],
        comments: [],
        restricted: true,
      },
      103: {
        id: 103,
        title: "Update footer",
        assignee: "leo",
        status: "closed",
        labels: ["ui"],
        comments: [],
        restricted: false,
      },
    },
    articles: {
      "kb-1": {
        id: "kb-1",
        title: "Incident response checklist",
        body: "Escalate to the incident commander.",
        owner: "Priya",
        status: "published",
        clientToken: "seed-checklist",
      },
    },
    nextArticleId: 2,
    members: {
      "member-1": { id: "member-1", name: "Ana", role: "viewer" },
      "member-2": { id: "member-2", name: "Bob", role: "editor" },
      "member-system": {
        id: "member-system",
        name: "System Owner",
        role: "admin",
      },
    },
  };
}

export function applyAction(state, action, input) {
  if (action === "session") return { userId: "benchmark-admin", role: "admin" };
  if (action === "search_products") {
    const query = String(input.query).toLowerCase();
    return state.products.filter(
      (product) =>
        product.name.toLowerCase().includes(query) &&
        (input.maxPrice === undefined || product.price <= input.maxPrice),
    );
  }
  if (action === "get_cart") return cartView(state);
  if (action === "add_to_cart") {
    requireEntity(
      state.products.find(({ id }) => id === input.productId),
      "product",
    );
    state.cart[input.productId] =
      (state.cart[input.productId] ?? 0) + input.quantity;
    return {
      productId: input.productId,
      quantity: state.cart[input.productId],
    };
  }
  if (action === "get_order")
    return requireEntity(state.orders[input.orderId], "order");
  if (action === "cancel_order") {
    const order = requireEntity(state.orders[input.orderId], "order");
    if (order.status !== "pending")
      deny("Only pending orders can be cancelled.");
    order.status = "cancelled";
    return order;
  }
  if (action === "search_issues") {
    return Object.values(state.issues).filter(
      (issue) =>
        (input.assignee === undefined || issue.assignee === input.assignee) &&
        (input.status === undefined || issue.status === input.status),
    );
  }
  if (action === "get_issue")
    return requireEntity(state.issues[input.issueId], "issue");
  if (action === "update_issue") {
    const issue = requireEntity(state.issues[input.issueId], "issue");
    if (issue.restricted) deny("Restricted issues are read-only.");
    for (const field of ["assignee", "labels", "status"]) {
      if (input[field] !== undefined) issue[field] = input[field];
    }
    return issue;
  }
  if (action === "comment_issue") {
    const issue = requireEntity(state.issues[input.issueId], "issue");
    if (issue.restricted) deny("Restricted issues are read-only.");
    issue.comments.push(input.body);
    return { issueId: issue.id, commentCount: issue.comments.length };
  }
  if (action === "search_articles") {
    const query = String(input.query).toLowerCase();
    return Object.values(state.articles).filter((article) =>
      `${article.title} ${article.body}`.toLowerCase().includes(query),
    );
  }
  if (action === "create_article") {
    const duplicate = Object.values(state.articles).find(
      ({ clientToken }) => clientToken === input.clientToken,
    );
    if (duplicate) return duplicate;
    const id = `kb-${state.nextArticleId++}`;
    return (state.articles[id] = {
      id,
      title: input.title,
      body: input.body,
      owner: "benchmark-admin",
      status: "draft",
      clientToken: input.clientToken,
    });
  }
  if (action === "get_article_by_token") {
    return (
      Object.values(state.articles).find(
        ({ clientToken }) => clientToken === input.clientToken,
      ) ?? null
    );
  }
  if (action === "get_article")
    return requireEntity(state.articles[input.articleId], "article");
  if (action === "publish_article") {
    const article = requireEntity(state.articles[input.articleId], "article");
    article.status = "published";
    return article;
  }
  if (action === "list_members") return Object.values(state.members);
  if (action === "set_role") {
    const member = requireEntity(state.members[input.memberId], "member");
    if (member.id === "member-system") deny("The system owner is protected.");
    member.role = input.role;
    return member;
  }
  const error = new Error(`Unknown fixture action: ${action}.`);
  error.status = 400;
  throw error;
}

function cartView(state) {
  const items = Object.entries(state.cart).map(([productId, quantity]) => {
    const product = state.products.find(({ id }) => id === productId);
    return { productId, name: product.name, quantity, price: product.price };
  });
  return {
    items,
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  };
}

function resolveAsset(pathname) {
  if (pathname === "/" || pathname === "/index.html")
    return join(fixtureRoot, "index.html");
  if (pathname.startsWith("/fixture/"))
    return safeJoin(fixtureRoot, pathname.slice(9));
  if (pathname.startsWith("/signet/"))
    return safeJoin(signetRoot, pathname.slice(8));
  if (pathname.startsWith("/vendor/json-schema/")) {
    return safeJoin(schemaRoot, pathname.slice(20));
  }
  return undefined;
}

function safeJoin(root, relative) {
  const target = resolve(root, relative);
  return target === root || target.startsWith(`${root}/`) ? target : undefined;
}

function requireEntity(entity, label) {
  if (entity) return entity;
  const error = new Error(`Unknown ${label}.`);
  error.status = 404;
  throw error;
}

function deny(message) {
  const error = new Error(message);
  error.status = 403;
  error.code = "forbidden";
  throw error;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}");
}

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function contentType(file) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[extname(file)] ?? "application/octet-stream"
  );
}
