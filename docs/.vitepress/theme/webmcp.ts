import {
  createSignett,
  type ModelContextLike,
  type SignettRegistration,
} from "signett";

type DeveloperObjective =
  | "choose-first-capability"
  | "add-first-tool"
  | "test-agent-workflow"
  | "harden-production-action"
  | "integrate-existing-app"
  | "troubleshoot-integration";

interface DocEntry {
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  readonly keywords: readonly string[];
}

interface GuideStep {
  readonly path: string;
  readonly reason: string;
  readonly doneWhen: string;
}

const docs: readonly DocEntry[] = [
  {
    path: "/guide/why-signett",
    title: "Why Signett",
    summary: "Decide when Signett adds value beyond raw WebMCP.",
    keywords: ["why", "adoption", "native", "raw", "comparison"],
  },
  {
    path: "/guide/user-jobs-workflow",
    title: "User jobs workflow",
    summary: "Choose a valuable product outcome before designing tools.",
    keywords: ["capability", "job", "design", "scope", "workflow"],
  },
  {
    path: "/guide/getting-started",
    title: "Getting started",
    summary: "Install Signett and expose a first browser-local WebMCP tool.",
    keywords: ["install", "first", "tool", "quickstart", "setup"],
  },
  {
    path: "/guide/core-concepts",
    title: "Core concepts",
    summary: "Understand tools, application context, guards, and lifecycle.",
    keywords: ["concepts", "context", "lifecycle", "execute", "schema"],
  },
  {
    path: "/tutorials/first-agent-call",
    title: "First agent call",
    summary: "Run a React example and let a browser agent invoke its tool.",
    keywords: ["react", "browser", "agent", "codelab", "example"],
  },
  {
    path: "/tutorials/headless-agent-testing",
    title: "Headless agent testing",
    summary: "Turn an agent job into a repeatable terminal-driven evaluation.",
    keywords: ["headless", "eval", "agent", "terminal", "regression"],
  },
  {
    path: "/guide/production-webmcp",
    title: "Production WebMCP",
    summary: "Move from a working demo to a production-shaped capability.",
    keywords: ["production", "security", "reliability", "checklist"],
  },
  {
    path: "/guide/authorization",
    title: "Authorization",
    summary: "Re-check identity, tenant, permissions, and resource access.",
    keywords: ["authorization", "auth", "permission", "tenant", "identity"],
  },
  {
    path: "/guide/idempotency-concurrency",
    title: "Idempotency and concurrency",
    summary: "Prevent duplicate effects and make concurrent calls predictable.",
    keywords: ["idempotency", "concurrency", "duplicate", "replay", "effect"],
  },
  {
    path: "/guide/verification",
    title: "Outcome verification",
    summary: "Prove consequential outcomes against authoritative state.",
    keywords: ["verify", "verification", "outcome", "recovery", "state"],
  },
  {
    path: "/guide/operation-journal",
    title: "Operation journals",
    summary: "Persist minimal correlation evidence for ambiguous outcomes.",
    keywords: ["journal", "recovery", "correlation", "ambiguous", "durable"],
  },
  {
    path: "/guide/testing",
    title: "Testing",
    summary: "Test tool discovery and execution without a model or browser.",
    keywords: ["test", "harness", "deterministic", "vitest", "discovery"],
  },
  {
    path: "/guide/application-activity",
    title: "Application activity",
    summary: "Reflect agent-triggered work in an application's existing UI.",
    keywords: ["activity", "ui", "react", "hook", "status"],
  },
  {
    path: "/guide/integration-patterns",
    title: "Integration patterns",
    summary: "Apply lessons from integrations with real applications.",
    keywords: ["integration", "existing", "application", "saleor", "cal"],
  },
  {
    path: "/guide/developer-tooling",
    title: "Developer tooling",
    summary: "Inspect registrations and diagnose an integration locally.",
    keywords: ["debug", "inspect", "tooling", "devtools", "diagnose"],
  },
  {
    path: "/reference/errors",
    title: "Error reference",
    summary: "Model expected failures and give agents repair guidance.",
    keywords: ["error", "failure", "repair", "retry", "exception"],
  },
  {
    path: "/reference/interface",
    title: "Interface reference",
    summary: "Look up createSignett, expose, tool definitions, and registration.",
    keywords: ["api", "interface", "createSignett", "expose", "reference"],
  },
  {
    path: "/production-checklist",
    title: "Production checklist",
    summary: "Review the controls required before shipping an agent action.",
    keywords: ["ship", "launch", "production", "review", "checklist"],
  },
] as const;

const guides: Readonly<Record<DeveloperObjective, readonly GuideStep[]>> = {
  "choose-first-capability": [
    {
      path: "/guide/user-jobs-workflow",
      reason: "Start with one user outcome instead of a broad API surface.",
      doneWhen: "You can name the job, its user, and its authoritative success signal.",
    },
    {
      path: "/guide/why-signett",
      reason: "Check whether the job needs Signett or only a small raw WebMCP tool.",
      doneWhen: "You can explain why the dependency earns its place.",
    },
    {
      path: "/guide/core-concepts",
      reason: "Map the chosen job to a tool boundary and application-owned logic.",
      doneWhen: "The proposed input, output, lifecycle, and state owner are clear.",
    },
  ],
  "add-first-tool": [
    {
      path: "/guide/getting-started",
      reason: "Install Signett and expose one read-only function.",
      doneWhen: "The registration reports registered in a WebMCP-enabled browser.",
    },
    {
      path: "/tutorials/first-agent-call",
      reason: "Prove discovery and invocation with a real browser agent.",
      doneWhen: "The agent selects the tool and returns its expected result.",
    },
    {
      path: "/guide/testing",
      reason: "Protect the tool boundary with a deterministic test.",
      doneWhen: "A test covers valid input, rejected input, and disposal.",
    },
  ],
  "test-agent-workflow": [
    {
      path: "/guide/testing",
      reason: "Start with deterministic discovery and invocation tests.",
      doneWhen: "The tool contract passes without a model or browser.",
    },
    {
      path: "/tutorials/headless-agent-testing",
      reason: "Run the developer's actual job through a fresh browser Trial.",
      doneWhen: "The Trial has an authoritative grader and retained evidence.",
    },
    {
      path: "/guide/developer-tooling",
      reason: "Inspect failures at the registration and execution boundary.",
      doneWhen: "A failed Trial can be assigned to a specific layer.",
    },
  ],
  "harden-production-action": [
    {
      path: "/guide/production-webmcp",
      reason: "Identify the controls required by the action's consequence level.",
      doneWhen: "The trust boundary and authoritative state owner are explicit.",
    },
    {
      path: "/guide/authorization",
      reason: "Re-check current access before every execution and replay.",
      doneWhen: "Identity, tenant, permission, and resource checks are tested.",
    },
    {
      path: "/guide/idempotency-concurrency",
      reason: "Make retries and concurrent calls safe.",
      doneWhen: "Equivalent calls cannot create duplicate effects.",
    },
    {
      path: "/guide/verification",
      reason: "Verify success using authoritative application state.",
      doneWhen: "The tool never claims success from transport response alone.",
    },
    {
      path: "/production-checklist",
      reason: "Perform the final pre-ship review.",
      doneWhen: "Every applicable control has evidence or an explicit owner.",
    },
  ],
  "integrate-existing-app": [
    {
      path: "/guide/user-jobs-workflow",
      reason: "Choose one existing application outcome as the integration seam.",
      doneWhen: "The smallest useful capability has been selected.",
    },
    {
      path: "/guide/integration-patterns",
      reason: "Reuse patterns proven in real application integrations.",
      doneWhen: "The tool calls existing business logic instead of duplicating it.",
    },
    {
      path: "/guide/application-activity",
      reason: "Make agent-triggered work legible in the existing UI.",
      doneWhen: "The UI refreshes from authoritative state after execution.",
    },
    {
      path: "/tutorials/headless-agent-testing",
      reason: "Grade the complete workflow rather than only the callback.",
      doneWhen: "A representative job passes in a fresh browser Trial.",
    },
  ],
  "troubleshoot-integration": [
    {
      path: "/guide/developer-tooling",
      reason: "Separate browser support, registration, selection, and execution failures.",
      doneWhen: "You know which layer owns the failure.",
    },
    {
      path: "/reference/errors",
      reason: "Check whether the failure should be modeled as an expected tool error.",
      doneWhen: "The agent receives a stable code and safe repair guidance.",
    },
    {
      path: "/reference/interface",
      reason: "Verify the exact registration and lifecycle contract.",
      doneWhen: "The implementation matches the current Signett API.",
    },
  ],
};

const docsByPath = new Map(docs.map((entry) => [entry.path, entry]));

function joinBase(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function tokenize(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function searchDocs(query: string, limit: number): readonly DocEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const queryTokens = tokenize(normalizedQuery);

  return docs
    .map((entry, index) => {
      const title = entry.title.toLowerCase();
      const searchable = `${title} ${entry.summary.toLowerCase()} ${entry.keywords.join(" ").toLowerCase()}`;
      let score = title.includes(normalizedQuery) ? 12 : 0;
      for (const token of queryTokens) {
        if (title.includes(token)) score += 5;
        if (entry.keywords.some((keyword) => keyword.toLowerCase().includes(token))) {
          score += 3;
        }
        if (searchable.includes(token)) score += 1;
      }
      return { entry, index, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export interface RegisterDocsWebMcpOptions {
  readonly base?: string;
  readonly origin?: string;
  readonly currentPage?: string;
  readonly modelContext?: ModelContextLike;
}

export interface DocsWebMcpRegistration {
  readonly registrations: readonly SignettRegistration[];
  dispose(): void;
}

export async function registerDocsWebMcp(
  options: RegisterDocsWebMcpOptions = {},
): Promise<DocsWebMcpRegistration> {
  const base = options.base ?? "/";
  const origin =
    options.origin ??
    (typeof window === "undefined" ? "https://signett.ai" : window.location.origin);
  const urlFor = (path: string): string =>
    new URL(joinBase(base, path), origin).href;
  const currentPage = (): string =>
    options.currentPage ??
    (typeof window === "undefined" ? urlFor("/") : window.location.href);
  const signett = createSignett(
    options.modelContext === undefined
      ? { unsupported: "ignore" }
      : { modelContext: options.modelContext, unsupported: "ignore" },
  );

  const registrations = await Promise.all([
    signett.expose<
      {
        objective: DeveloperObjective;
        framework?: string;
      },
      object
    >({
      name: "guide_signett_developer",
      title: "Guide a Signett developer",
      description:
        "Build a short, ordered documentation path for a developer who wants to choose, add, test, harden, integrate, or troubleshoot a Signett WebMCP capability. Use this when the developer asks what to do or read next.",
      inputSchema: {
        type: "object",
        properties: {
          objective: {
            type: "string",
            enum: [
              "choose-first-capability",
              "add-first-tool",
              "test-agent-workflow",
              "harden-production-action",
              "integrate-existing-app",
              "troubleshoot-integration",
            ],
            description: "The outcome the developer is trying to reach now.",
          },
          framework: {
            type: "string",
            minLength: 1,
            maxLength: 60,
            description:
              "Optional application framework, such as React, Next.js, Vue, or VitePress.",
          },
        },
        required: ["objective"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      outputBudgetBytes: 12_000,
      execute: ({ objective, framework }) => ({
        objective,
        ...(framework === undefined ? {} : { framework }),
        currentPage: currentPage(),
        guidance:
          framework?.toLowerCase().includes("react") === true
            ? "Use Signett's React lifecycle bindings for component-owned tools; keep business logic outside the tool definition."
            : "Register tools from client-side code and dispose them when the capability is no longer available.",
        steps: guides[objective].map((step, index) => {
          const doc = docsByPath.get(step.path);
          if (!doc) throw new Error(`Missing documentation entry for ${step.path}.`);
          return {
            order: index + 1,
            title: doc.title,
            url: urlFor(step.path),
            reason: step.reason,
            doneWhen: step.doneWhen,
          };
        }),
        finalInstruction:
          "Work through one step at a time. Ask the developer for application-specific facts before proposing consequential tool behavior.",
      }),
    }),
    signett.expose<{ query: string; limit?: number }, object>({
      name: "search_signett_docs",
      title: "Search Signett documentation",
      description:
        "Find the most relevant Signett documentation pages for a specific WebMCP, integration, testing, reliability, or troubleshooting question.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 2,
            maxLength: 160,
            description: "A concise topic or developer question.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            default: 3,
            description: "Maximum number of documentation pages to return.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      outputBudgetBytes: 8_000,
      execute: ({ query, limit = 3 }) => {
        const matches = searchDocs(query, limit);
        return {
          query,
          currentPage: currentPage(),
          matches: matches.map((entry) => ({
            title: entry.title,
            url: urlFor(entry.path),
            summary: entry.summary,
          })),
          ...(matches.length === 0
            ? {
                suggestion:
                  "No close topic match was found. Start with the getting-started guide or call guide_signett_developer for an ordered path.",
                gettingStarted: urlFor("/guide/getting-started"),
              }
            : {}),
        };
      },
    }),
  ]);

  return {
    registrations,
    dispose() {
      for (const registration of registrations) registration.dispose();
    },
  };
}
