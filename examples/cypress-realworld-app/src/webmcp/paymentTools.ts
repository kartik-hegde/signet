/// <reference types="webmcp-types" />

import { guard } from "../../../../src/index";
import { MemoryIdempotencyStore } from "../../../../src/testing";
import { backendPort } from "../utils/portUtils";

type ToolInput<T extends object> = T & Record<string, unknown>;

type PaymentContext = {
  userId: string;
  accounts: Array<{ id: string; bankName: string; accountNumberLast4: string }>;
};

type SendPaymentInput = ToolInput<{
  operationId: string;
  sourceAccountId: string;
  receiverId: string;
  amount: number;
  description: string;
}>;

type PaymentResponse = {
  operation: {
    operationId: string;
    userId: string;
    transactionId: string;
    createdAt: string;
  };
  transaction: {
    id: string;
    source: string;
    amount: number;
    description: string;
    receiverId: string;
    senderId: string;
    status: string;
  };
  replayed: boolean;
};

type GuardEventSummary = {
  name?: string;
  stage: string;
  invocationId: string;
};

type InstrumentedWindow = Window & {
  __signetGuardEvents?: GuardEventSummary[];
};

const apiUrl = `http://localhost:${backendPort}/webmcp`;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || `Request failed with status ${response.status}.`);
    Object.assign(error, { status: response.status, body });
    throw error;
  }
  return body as T;
}

const paymentContext = (_input: Record<string, unknown>, { signal }: { signal: AbortSignal }) =>
  requestJson<PaymentContext>("/context", { signal });

const recordGuardEvent = (event: GuardEventSummary) => {
  const target = window as InstrumentedWindow;
  target.__signetGuardEvents ??= [];
  target.__signetGuardEvents.push({
    name: event.name,
    stage: event.stage,
    invocationId: event.invocationId,
  });
};

export function registerPaymentTools(onPaymentCreated: (transactionId: string) => void) {
  const registration = new AbortController();
  const modelContext = document.modelContext;
  if (!modelContext) return registration;

  const idempotencyStore = new MemoryIdempotencyStore();

  const searchUsers = async (
    input: ToolInput<{ query: string }>,
    { signal }: { signal: AbortSignal }
  ) =>
    requestJson<{ users: Array<{ id: string; username: string; displayName: string }> }>(
      `/payment-users?q=${encodeURIComponent(input.query)}`,
      { signal }
    );

  const listAccounts = async (
    _input: Record<string, never>,
    { signal }: { signal: AbortSignal }
  ) => requestJson<PaymentContext>("/context", { signal });

  const sendPayment = guard<SendPaymentInput, PaymentResponse, PaymentContext>(
    async (input, { signal }) => {
      const result = await requestJson<PaymentResponse>("/payments", {
        method: "POST",
        signal,
        body: JSON.stringify(input),
      });
      onPaymentCreated(result.transaction.id);
      return result;
    },
    {
      name: "send_payment",
      context: paymentContext,
      authorize: ({ input, context }) => {
        if (input.receiverId === context.userId) {
          return { allowed: false, reason: "A user cannot pay themselves." };
        }
        if (!context.accounts.some((account) => account.id === input.sourceAccountId)) {
          return {
            allowed: false,
            reason: "The source account is not available to the signed-in user.",
          };
        }
        return true;
      },
      idempotency: {
        key: ({ input, context }) =>
          [
            context.userId,
            "send_payment",
            input.operationId,
            input.sourceAccountId,
            input.receiverId,
            Math.round(input.amount * 100),
            input.description.trim(),
          ].join(":"),
        store: idempotencyStore,
      },
      verify: async ({ input, output, context, signal }) => {
        const authoritative = await requestJson<Omit<PaymentResponse, "replayed">>(
          `/payments/${encodeURIComponent(input.operationId)}`,
          { signal }
        );
        const transaction = authoritative.transaction;
        const verified =
          authoritative.operation.transactionId === output.transaction.id &&
          authoritative.operation.userId === context.userId &&
          transaction.senderId === context.userId &&
          transaction.receiverId === input.receiverId &&
          transaction.source === input.sourceAccountId &&
          transaction.amount === Math.round(input.amount * 100) &&
          transaction.description === input.description.trim() &&
          transaction.status === "complete";

        return verified
          ? true
          : { verified: false, reason: "Authoritative payment state did not match the request." };
      },
      observe: recordGuardEvent,
    }
  );

  const registrations = [
    modelContext.registerTool(
      {
        name: "search_payment_users",
        title: "Search payment recipients",
        description: "Find signed-in-app users who can receive a payment.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", minLength: 1, maxLength: 64 } },
          required: ["query"],
          additionalProperties: false,
        },
        execute: searchUsers as WebMCP.ToolExecuteCallback,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
      },
      { signal: registration.signal }
    ),
    modelContext.registerTool(
      {
        name: "list_payment_accounts",
        title: "List payment source accounts",
        description: "List payment accounts owned by the signed-in user.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: listAccounts as WebMCP.ToolExecuteCallback,
        annotations: { readOnlyHint: true },
      },
      { signal: registration.signal }
    ),
    modelContext.registerTool(
      {
        name: "send_payment",
        title: "Send a payment",
        description:
          "Send one payment from an account owned by the signed-in user. Reuse operationId when retrying the same intended payment.",
        inputSchema: {
          type: "object",
          properties: {
            operationId: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
            sourceAccountId: { type: "string", minLength: 1 },
            receiverId: { type: "string", minLength: 1 },
            amount: { type: "number", exclusiveMinimum: 0, maximum: 10000, multipleOf: 0.01 },
            description: { type: "string", minLength: 1, maxLength: 140 },
          },
          required: ["operationId", "sourceAccountId", "receiverId", "amount", "description"],
          additionalProperties: false,
        },
        execute: sendPayment as WebMCP.ToolExecuteCallback,
      },
      { signal: registration.signal }
    ),
  ];

  void Promise.all(registrations).catch((error: unknown) => {
    console.error("Failed to register payment tools", error);
  });

  registration.signal.addEventListener("abort", () => idempotencyStore.clear(), { once: true });
  return registration;
}
