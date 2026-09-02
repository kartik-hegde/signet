import { defineConfig } from "vitepress";

const base = process.env.DOCS_BASE ?? "/";

export default defineConfig({
  base,
  title: "Signet WebMCP",
  description:
    "Agent-interface tooling for exposing and verifying product capabilities through native WebMCP.",
  cleanUrls: true,
  lastUpdated: true,
  appearance: false,
  head: [["meta", { name: "theme-color", content: "#ffffff" }]],
  themeConfig: {
    siteTitle: "Signet",
    nav: [
      { text: "Docs", link: "/guide/getting-started" },
      { text: "Tutorials", link: "/tutorials/" },
      {
        text: "Examples",
        link: "https://github.com/kartik-hegde/signet/tree/main/fixtures",
      },
      { text: "Resources", link: "/resources" },
      {
        text: "Benchmarks",
        link: "https://github.com/kartik-hegde/signet/tree/main/benchmarks",
      },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Why Signet", link: "/guide/why-signet" },
          { text: "Getting started", link: "/guide/getting-started" },
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
            text: "2. Authenticated payment",
            link: "/guide/real-browser-example",
          },
          { text: "3. Cal.diy booking", link: "/tutorials/cal-diy" },
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
          { text: "OpenTelemetry", link: "/reference/opentelemetry" },
        ],
      },
      {
        text: "Case studies",
        items: [{ text: "Saleor checkout", link: "/case-studies/saleor" }],
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
      pattern: "https://github.com/kartik-hegde/signet/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Your product capabilities, directly usable by agents.",
      copyright: "Released under the MIT License.",
    },
  },
});
