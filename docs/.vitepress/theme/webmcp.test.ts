import { describe, expect, it } from "vitest";
import { createWebMcpTestHarness } from "signett/testing";
import { registerDocsWebMcp } from "./webmcp";

describe("Signett documentation WebMCP tools", () => {
  it("returns an ordered, base-aware developer learning path", async () => {
    const harness = createWebMcpTestHarness();
    const docsWebMcp = await registerDocsWebMcp({
      base: "/signett/",
      origin: "https://docs.example.com",
      currentPage: "https://docs.example.com/signett/guide/getting-started",
      modelContext: harness.modelContext,
    });

    expect(harness.tools().map(({ name }) => name)).toEqual([
      "guide_signett_developer",
      "search_signett_docs",
    ]);

    const result = (await harness.invoke("guide_signett_developer", {
      objective: "add-first-tool",
      framework: "React",
    })) as {
      guidance: string;
      steps: Array<{ order: number; title: string; url: string }>;
    };

    expect(result.guidance).toContain("React lifecycle bindings");
    expect(result.steps[0]).toEqual({
      order: 1,
      title: "Getting started",
      url: "https://docs.example.com/signett/guide/getting-started",
      reason: "Install Signett and expose one read-only function.",
      doneWhen:
        "The registration reports registered in a WebMCP-enabled browser.",
    });

    docsWebMcp.dispose();
    expect(harness.tools()).toEqual([]);
  });

  it("finds focused documentation for a developer question", async () => {
    const harness = createWebMcpTestHarness();
    const docsWebMcp = await registerDocsWebMcp({
      origin: "https://signett.ai",
      modelContext: harness.modelContext,
    });

    const result = (await harness.invoke("search_signett_docs", {
      query: "How do I prevent duplicate effects with idempotency?",
      limit: 2,
    })) as {
      matches: Array<{ title: string; url: string }>;
    };

    expect(result.matches[0]).toMatchObject({
      title: "Idempotency and concurrency",
      url: "https://signett.ai/guide/idempotency-concurrency",
    });
    expect(result.matches).toHaveLength(2);

    docsWebMcp.dispose();
  });
});
