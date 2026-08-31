/// <reference types="webmcp-types" />

import { guard, type Execute } from "../src/index.js";
import { MemoryIdempotencyStore } from "../src/testing.js";

interface DomainResult {
  readonly domain: string;
  readonly available: boolean;
}

interface ReservationResult {
  readonly reservationId: string;
  readonly domain: string;
  readonly state: "reserved";
}

// Start with a capability the application already owns. WebMCP callback input is
// untrusted, so the handler validates it before calling the backend.
const searchDomain: WebMCP.ToolExecuteCallback = async (input, { signal }) => {
  if (typeof input.domain !== "string" || input.domain.length === 0) {
    throw new TypeError("domain must be a non-empty string");
  }

  const response = await fetch(
    `/api/domains/${encodeURIComponent(input.domain)}`,
    { signal },
  );
  if (!response.ok) throw new Error(`Domain search failed: ${response.status}`);
  return response.json() as Promise<DomainResult>;
};

// Add execution controls only to the consequential action. The in-memory store keeps
// this example self-contained; production code needs an application-owned durable
// store and authoritative backend enforcement.
const reserveDomain: Execute<
  Record<string, unknown>,
  ReservationResult
> = guard(
  async (input, { signal }) => {
    if (typeof input.domain !== "string" || input.domain.length === 0) {
      throw new TypeError("domain must be a non-empty string");
    }

    const response = await fetch("/api/domain-reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: input.domain }),
      signal,
    });
    if (!response.ok)
      throw new Error(`Domain reservation failed: ${response.status}`);
    return response.json() as Promise<ReservationResult>;
  },
  {
    name: "reserve_domain",
    context: () => currentSession(),
    authorize: ({ context }) => context.canReserveDomains,
    idempotency: {
      key: ({ input, context }) =>
        `${context.userId}:${String(input.domain).toLowerCase()}:reserve`,
      store: new MemoryIdempotencyStore(),
    },
    verify: ({ input, output }) =>
      output.domain === input.domain && output.state === "reserved",
  },
);

const registration = new AbortController();

await Promise.all([
  document.modelContext?.registerTool(
    {
      name: "search_domains",
      title: "Search domain availability",
      description:
        "Checks whether one exact domain name is currently available to reserve.",
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
  ),
  document.modelContext?.registerTool(
    {
      name: "reserve_domain",
      title: "Reserve a domain",
      description:
        "Reserves one available domain for the signed-in user without purchasing it.",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "A fully qualified, currently available domain name.",
          },
        },
        required: ["domain"],
        additionalProperties: false,
      },
      execute: reserveDomain,
    },
    { signal: registration.signal },
  ),
]);

// Later: registration.abort() unregisters both tools using native WebMCP lifecycle.

declare function currentSession(): {
  readonly userId: string;
  readonly canReserveDomains: boolean;
};
