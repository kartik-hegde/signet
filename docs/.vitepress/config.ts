import { defineConfig, type HeadConfig } from "vitepress";

const base = process.env.DOCS_BASE ?? "/";
const webMcpOriginTrialToken = process.env.WEBMCP_ORIGIN_TRIAL_TOKEN;
const webMcpOriginTrialHead: HeadConfig[] = webMcpOriginTrialToken
  ? [
      [
        "meta",
        {
          "http-equiv": "origin-trial",
          content: webMcpOriginTrialToken,
        },
      ],
    ]
  : [];

export default defineConfig({
  base,
  title: "Signett WebMCP",
  description:
    "Agent-interface tooling for exposing and verifying product capabilities through native WebMCP.",
  cleanUrls: true,
  lastUpdated: true,
  appearance: false,
  head: [
    ["meta", { name: "theme-color", content: "#ffffff" }],
    ...webMcpOriginTrialHead,
  ],
  themeConfig: {
    siteTitle: "Signett",
    nav: [
      { text: "Docs", link: "/guide/what-is-signett" },
      { text: "Tutorials", link: "/tutorials/" },
      {
        text: "Examples",
        link: "https://github.com/signettai/signett/tree/main/fixtures",
      },
      { text: "Resources", link: "/resources" },
      { text: "Benchmarks", link: "/benchmarks" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "What is Signett?", link: "/guide/what-is-signett" },
          { text: "Why Signett", link: "/guide/why-signett" },
          {
            text: "User jobs workflow",
            link: "/guide/user-jobs-workflow",
          },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Agent-guided docs", link: "/guide/agent-guided-docs" },
          { text: "Core concepts", link: "/guide/core-concepts" },
          { text: "Production WebMCP", link: "/guide/production-webmcp" },
        ],
      },
      {
        text: "Tutorials",
        items: [
          { text: "Choose a codelab", link: "/tutorials/" },
          { text: "1. First agent call", link: "/tutorials/first-agent-call" },
          {
            text: "2. Headless agent testing",
            link: "/tutorials/headless-agent-testing",
          },
          {
            text: "3. Authenticated payment",
            link: "/guide/real-browser-example",
          },
          { text: "4. Cal.diy booking", link: "/tutorials/cal-diy" },
          {
            text: "Patterns from integrations",
            link: "/guide/integration-patterns",
          },
        ],
      },
      {
        text: "Production controls",
        items: [
          { text: "Authorization", link: "/guide/authorization" },
          {
            text: "Idempotency & concurrency",
            link: "/guide/idempotency-concurrency",
          },
          { text: "Outcome verification", link: "/guide/verification" },
          { text: "Operation journals", link: "/guide/operation-journal" },
          { text: "Testing", link: "/guide/testing" },
          {
            text: "Application activity",
            link: "/guide/application-activity",
          },
          { text: "Developer tooling", link: "/guide/developer-tooling" },
          { text: "Performance", link: "/guide/performance" },
        ],
      },
      {
        text: "API reference",
        items: [
          { text: "Interface", link: "/reference/interface" },
          { text: "guard", link: "/reference/guard" },
          { text: "Errors", link: "/reference/errors" },
          { text: "CLI", link: "/reference/cli" },
          { text: "OpenTelemetry", link: "/reference/opentelemetry" },
        ],
      },
      {
        text: "Case studies",
        items: [
          { text: "Latest benchmark results", link: "/benchmarks" },
          { text: "Saleor checkout", link: "/case-studies/saleor" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Production checklist", link: "/production-checklist" },
          { text: "Design contract", link: "/design" },
          { text: "Observability spec", link: "/specs/observability" },
          { text: "Ecosystem research", link: "/ecosystem" },
          { text: "Product tracker", link: "/pm" },
        ],
      },
    ],
    outline: { level: [2, 3] },
    editLink: {
      pattern: "https://github.com/signettai/signett/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Your product capabilities, directly usable by agents.",
      copyright: "Released under the MIT License.",
    },
  },
});
