import { describe, expect, it } from "vitest";

import {
  assertToolReady,
  createSignet,
} from "../../../packages/webmcp/src/index.js";
import { createWebMcpTestHarness } from "../../../packages/webmcp/src/testing.js";

import { greetingTool } from "./greeting";

describe("hello-world codelab", () => {
  it("exposes and invokes get_greeting", async () => {
    assertToolReady(greetingTool);

    const harness = createWebMcpTestHarness();
    const signet = createSignet({ modelContext: harness.modelContext });
    await signet.expose(greetingTool);

    expect(harness.tools().map((tool) => tool.name)).toEqual(["get_greeting"]);
    await expect(harness.invoke("get_greeting", {})).resolves.toEqual({
      message: "Hello, world!",
    });
  });
});
