import assert from "node:assert/strict";
import test from "node:test";

import {
  parseInline,
  parseMarkdown,
  resolveMarkdownUrl,
} from "../markdown.mjs";

test("parses headings, emphasis, product links, lists, and rules", () => {
  const blocks = parseMarkdown(`Here are the options:

---

### **1. Classic Hardside Luggage**

*Durable polycarbonate shell.*

* **[The Carry-On](/products/carry-on)** – **$220.00**`);

  assert.deepEqual(
    blocks.map((block) => block.type),
    ["paragraph", "rule", "heading", "paragraph", "list"],
  );
  assert.equal(blocks[2].children[0].type, "strong");
  assert.equal(blocks[3].children[0].type, "emphasis");
  assert.equal(blocks[4].items[0][0].children[0].type, "link");
});

test("keeps raw HTML as text rather than executable markup", () => {
  assert.deepEqual(parseInline('<img src=x onerror="alert(1)">'), [
    { type: "text", value: '<img src=x onerror="alert(1)">' },
  ]);
});

test("resolves relative links against the inspected page and rejects scripts", () => {
  assert.equal(
    resolveMarkdownUrl("/products/carry-on", "https://www.aloyoga.com/shop"),
    "https://www.aloyoga.com/products/carry-on",
  );
  assert.equal(
    resolveMarkdownUrl("javascript:alert(1)", "https://www.aloyoga.com"),
    undefined,
  );
});
