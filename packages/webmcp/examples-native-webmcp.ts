/// <reference types="webmcp-types" />

import { createSignet } from "./src/index.js";
import {
  MemoryIdempotencyStore,
  MemoryOperationJournal,
} from "./src/testing.js";

interface DomainResult {
  readonly domain: string;
  readonly available: boolean;
}

interface ReservationResult {
  readonly reservationId: string;
  readonly domain: string;
  readonly state: "reserved";
}

type DomainInput = { domain: string } & Record<string, unknown>;

const signet = createSignet({
  context: () => currentSession(),
});

const domainSchema = {
  type: "object",
  properties: {
    domain: {
      type: "string",
      minLength: 1,
      maxLength: 253,
      description: "A fully qualified domain name, such as example.com.",
    },
  },
  required: ["domain"],
  additionalProperties: false,
};

const searchRegistration = await signet.expose({
  name: "search_domains",
  title: "Search domain availability",
  description:
    "Check whether one exact domain is currently available to reserve.",
  inputSchema: domainSchema,
  annotations: { readOnlyHint: true },
  execute: async ({ domain }: { domain: string }, { signal }) => {
    const response = await fetch(`/api/domains/${encodeURIComponent(domain)}`, {
      signal,
    });
    if (!response.ok)
      throw new Error(`Domain search failed: ${response.status}`);
    return response.json() as Promise<DomainResult>;
  },
});

const reserveRegistration = await signet.expose<DomainInput, ReservationResult>(
  {
    name: "reserve_domain",
    title: "Reserve a domain",
    description:
      "Reserve one available domain for the signed-in user without purchasing it.",
    inputSchema: domainSchema,
    idempotency: {
      key: ({ input, context }) =>
        `${context.userId}:${input.domain.toLowerCase()}:reserve`,
      // Self-contained for the example. Use an application-owned durable store
      // in production.
      store: new MemoryIdempotencyStore(),
    },
    journal: { store: new MemoryOperationJournal() },
    authorize: ({ context }) => context.canReserveDomains,
    execute: async ({ domain }, { operation, signal }) => {
      await operation?.write({ domain });
      const response = await fetch("/api/domain-reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Domain reservation failed: ${response.status}`);
      }
      return response.json() as Promise<ReservationResult>;
    },
    verify: ({ input, output }) =>
      output.domain === input.domain && output.state === "reserved",
  },
);

// Later, when this product surface unmounts:
searchRegistration.dispose();
reserveRegistration.dispose();

declare function currentSession(): {
  readonly userId: string;
  readonly canReserveDomains: boolean;
};
