/// <reference types="webmcp-types" />

import { createSignet, type GuardEvent } from "../../../../src/index";
import {
  MemoryIdempotencyStore,
  MemoryOperationJournal,
} from "../../../../src/testing";
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

type AuthoritativePayment = Omit<PaymentResponse, "replayed">;

type GuardEventSummary = {
  name?: string;
  stage: string;
  invocationId: string;
};

type InstrumentedWindow = Window & {
  __signetGuardEvents?: GuardEventSummary[];
};

const apiUrl = "http://localhost:" + backendPort + "/webmcp";
const registrationStages = new Set([
  "registering",
  "registered",
  "unsupported",
  "registration_failed",
  "unregistered",
]);

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl + path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  const body = await response.json();
  if (!response.ok) {
    const error = new Error(
      body.error || "Request failed with status " + response.status + ".",
    );
    Object.assign(error, { status: response.status, body });
    throw error;
  }
  return body as T;
}

function matchesPayment(
  authoritative: AuthoritativePayment,
  input: SendPaymentInput,
  context: PaymentContext,
): boolean {
  const transaction = authoritative.transaction;
  return (
    authoritative.operation.userId === context.userId &&
    transaction.senderId === context.userId &&
    transaction.receiverId === input.receiverId &&
    transaction.source === input.sourceAccountId &&
    transaction.amount === Math.round(input.amount * 100) &&
    transaction.description === input.description.trim() &&
    transaction.status === "complete"
  );
}

const recordGuardEvent = (event: GuardEvent) => {
  const summary = {
    name: event.name,
    stage: event.stage,
    invocationId: event.invocationId,
  };
  window.dispatchEvent(
    new CustomEvent("signet:event", { detail: summary }),
  );
  if (registrationStages.has(event.stage)) return;
  const target = window as InstrumentedWindow;
  target.__signetGuardEvents ??= [];
  target.__signetGuardEvents.push(summary);
};

export function registerPaymentTools(
  onPaymentCreated: (transactionId: string) => void,
) {
  const lifecycle = new AbortController();
  if (!document.modelContext) return lifecycle;

  const idempotencyStore = new MemoryIdempotencyStore();
  const operationJournal = new MemoryOperationJournal();
  const readTools = createSignet();
  const paymentTools = createSignet<PaymentContext>({
    context: ({ signal }) =>
      requestJson<PaymentContext>("/context", { signal }),
    observe: recordGuardEvent,
  });

  const registrations = Promise.all([
    readTools.expose({
      name: "search_payment_users",
      title: "Search payment recipients",
      description: "Find signed-in-app users who can receive a payment.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 64 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (
        { query }: ToolInput<{ query: string }>,
        { signal },
      ) =>
        requestJson<{
          users: Array<{
            id: string;
            username: string;
            displayName: string;
          }>;
        }>("/payment-users?q=" + encodeURIComponent(query), { signal }),
    }),
    readTools.expose({
      name: "list_payment_accounts",
      title: "List payment source accounts",
      description: "List payment accounts owned by the signed-in user.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (_input: Record<string, never>, { signal }) =>
        requestJson<PaymentContext>("/context", { signal }),
    }),
    paymentTools.expose<SendPaymentInput, PaymentResponse>({
      name: "send_payment",
      title: "Send a payment",
      description:
        "Send one payment from an account owned by the signed-in user. " +
        "Reuse operationId when retrying the same intended payment.",
      inputSchema: {
        type: "object",
        properties: {
          operationId: {
            type: "string",
            pattern: "^[A-Za-z0-9._:-]{1,128}$",
          },
          sourceAccountId: { type: "string", minLength: 1 },
          receiverId: { type: "string", minLength: 1 },
          amount: {
            type: "number",
            exclusiveMinimum: 0,
            maximum: 10000,
            multipleOf: 0.01,
          },
          description: { type: "string", minLength: 1, maxLength: 140 },
        },
        required: [
          "operationId",
          "sourceAccountId",
          "receiverId",
          "amount",
          "description",
        ],
        additionalProperties: false,
      },
      authorize: ({ input, context }) => {
        if (input.receiverId === context.userId) {
          return { allowed: false, reason: "A user cannot pay themselves." };
        }
        if (
          !context.accounts.some(
            (account) => account.id === input.sourceAccountId,
          )
        ) {
          return {
            allowed: false,
            reason:
              "The source account is not available to the signed-in user.",
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
      journal: { store: operationJournal },
      execute: async (input, { operation, signal }) => {
        await operation?.write({ operationId: input.operationId });
        let result: PaymentResponse;
        try {
          result = await requestJson<PaymentResponse>("/payments", {
            method: "POST",
            signal,
            body: JSON.stringify(input),
          });
        } catch (error) {
          // An HTTP response proves the server rejected the request. Network
          // failures retain the journal entry because the outcome is ambiguous.
          if (
            error instanceof Error &&
            "status" in error &&
            typeof error.status === "number"
          ) {
            await operation?.remove();
          }
          throw error;
        }
        onPaymentCreated(result.transaction.id);
        return result;
      },
      recover: async ({ input, context, operation, signal }) => {
        const correlation = await operation?.read<{ operationId: string }>();
        if (correlation?.operationId !== input.operationId) {
          return { recovered: false };
        }
        try {
          const authoritative = await requestJson<AuthoritativePayment>(
            "/payments/" + encodeURIComponent(input.operationId),
            { signal },
          );
          if (!matchesPayment(authoritative, input, context)) {
            return { recovered: false };
          }

          onPaymentCreated(authoritative.transaction.id);
          return {
            recovered: true,
            output: { ...authoritative, replayed: true },
          };
        } catch {
          return { recovered: false };
        }
      },
      verify: async ({ input, output, context, signal }) => {
        const authoritative = await requestJson<AuthoritativePayment>(
          "/payments/" + encodeURIComponent(input.operationId),
          { signal },
        );
        const verified =
          authoritative.operation.transactionId === output.transaction.id &&
          matchesPayment(authoritative, input, context);

        return verified
          ? true
          : {
              verified: false,
              reason:
                "Authoritative payment state did not match the request.",
            };
      },
    }),
  ]);

  void registrations.catch((error: unknown) => {
    console.error("Failed to register payment tools", error);
  });

  lifecycle.signal.addEventListener(
    "abort",
    () => {
      void registrations.then((handles) => {
        for (const handle of handles) handle.dispose();
      });
      idempotencyStore.clear();
      operationJournal.clear();
    },
    { once: true },
  );

  return lifecycle;
}
