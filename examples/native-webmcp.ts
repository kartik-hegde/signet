/// <reference types="webmcp-types" />

import { guard, type Execute } from "../src/index.js";
import { MemoryIdempotencyStore } from "../src/testing.js";

interface DomainResult {
  readonly domain: string;
  readonly available: boolean;
}

const idempotency = new MemoryIdempotencyStore();

// Production code should use the application's durable store and authenticated
// backend. Record<string, unknown> matches the official WebMCP callback type;
// the handler validates and narrows untrusted agent input at the boundary.
const searchDomain: Execute<Record<string, unknown>, DomainResult> = guard(
  async (input, { signal }) => {
    if (typeof input.domain !== "string" || input.domain.length === 0) {
      throw new TypeError("domain must be a non-empty string");
    }

    const response = await fetch(
      `/api/domains/${encodeURIComponent(input.domain)}`,
      { signal },
    );
    if (!response.ok) throw new Error(`Domain search failed: ${response.status}`);
    return response.json() as Promise<DomainResult>;
  },
  {
    name: "search-domain",
    context: () => ({ signedIn: true }),
    authorize: ({ context }) => context.signedIn,
    idempotency: {
      key: ({ input }) => `search:${String(input.domain).toLowerCase()}`,
      store: idempotency,
    },
    verify: ({ input, output }) => output.domain === input.domain,
  },
);

const registration = new AbortController();

await document.modelContext?.registerTool(
  {
    name: "search-domain",
    title: "Search domain availability",
    description: "Checks whether one exact domain name is available to register.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "A fully qualified domain name, such as example.com.",
        },
      },
      required: ["domain"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: searchDomain,
  },
  { signal: registration.signal },
);

// Later: registration.abort() unregisters the tool using native WebMCP lifecycle.
