import { defineConfig } from "vitepress";

const base = process.env.DOCS_BASE ?? "/";

export default defineConfig({
  base,
  title: "Signet",
  description: "WebMCP-first tooling for exposing product capabilities to AI agents.",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["meta", { name: "theme-color", content: "#a84a12" }],
    ["link", { rel: "icon", href: `${base}mark.svg`, type: "image/svg+xml" }],
  ],
  themeConfig: {
    // VitePress applies `base` to theme assets automatically.
    logo: "/mark.svg",
    siteTitle: "Signet",
    search: { provider: "local" },
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/reference/interface" },
      { text: "Checklist", link: "/production-checklist" },
      { text: "GitHub", link: "https://github.com/kartik-hegde/signet" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Why Signet", link: "/guide/why-signet" },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Production WebMCP", link: "/guide/production-webmcp" },
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
          { text: "Testing", link: "/guide/testing" },
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
        text: "Project",
        items: [
          { text: "Production checklist", link: "/production-checklist" },
          { text: "Design contract", link: "/design" },
          { text: "Ecosystem research", link: "/ecosystem" },
        ],
      },
    ],
    outline: { level: [2, 3] },
    editLink: {
      pattern: "https://github.com/kartik-hegde/signet/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/kartik-hegde/signet" },
    ],
    footer: {
      message: "Your product capabilities, directly usable by agents.",
      copyright: "Released under the MIT License.",
    },
  },
});
