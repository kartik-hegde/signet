/// <reference types="webmcp-types" />

import {
  guard,
  type ExecuteOptions,
  type GuardEvent,
} from "../../../../packages/webmcp/src/index";
import {
  MemoryIdempotencyStore,
  MemoryOperationJournal,
} from "../../../../packages/webmcp/src/testing";
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
  __signettGuardEvents?: GuardEventSummary[];
  __webMcpBenchmarkMode?: "raw" | "signett";
};

type MetadataVariant = "baseline" | "explicit" | "guided";

const metadataVariant = (): MetadataVariant => {
  const value = window.localStorage.getItem("signett:eval:metadata");
  return value === "explicit" || value === "guided" ? value : "baseline";
};

const toolCopy = () => {
  const variant = metadataVariant();
  if (variant === "guided") {
    return {
      search:
        "Search payment recipients by display name or username. Use this first when a task names a recipient but does not provide their stable receiverId.",
      accounts:
        "List source accounts owned by the signed-in user. Use this before send_payment to obtain an allowed sourceAccountId.",
      payment:
        "Create exactly one payment. First resolve receiverId and sourceAccountId. Choose one stable operationId for the intended payment and reuse that same ID after any timeout or interrupted response.",
      query: "Recipient display name or username; partial names are accepted.",
      operationId:
        "Stable caller-chosen ID for this intended payment. Reuse it unchanged when retrying.",
      sourceAccountId: "An account ID returned by list_payment_accounts.",
      receiverId: "A recipient ID returned by search_payment_users.",
      amount: "Payment amount in dollars with at most two decimal places.",
      description: "User-visible payment note, copied exactly from the task when supplied.",
    };
  }
  if (variant === "explicit") {
    return {
      search:
        "Find signed-in-app users who can receive a payment. Use when a recipient name must be resolved to receiverId.",
      accounts:
        "List payment accounts owned by the signed-in user. Use when sourceAccountId is unknown.",
      payment:
        "Send one payment from an owned account. Reuse operationId when retrying the same intended payment.",
      query: "Recipient name or username.",
      operationId: "Stable ID for safe retries of this payment.",
      sourceAccountId: "Owned source account ID.",
      receiverId: "Recipient user ID.",
      amount: "Amount in dollars.",
      description: "Payment note.",
    };
  }
  return {
    search: "Find signed-in-app users who can receive a payment.",
    accounts: "List payment accounts owned by the signed-in user.",
    payment:
      "Send one payment from an account owned by the signed-in user. Reuse operationId when retrying the same intended payment.",
    query: undefined,
    operationId: undefined,
    sourceAccountId: undefined,
    receiverId: undefined,
    amount: undefined,
    description: undefined,
  };
};

const apiUrl = `http://localhost:${backendPort}/webmcp`;

const executionSignal = (options?: WebMCP.ToolExecuteCallbackOptions) =>
  options?.signal ?? new AbortController().signal;

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

function matchesPayment(
  authoritative: AuthoritativePayment,
  input: SendPaymentInput,
  context: PaymentContext
) {
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

const paymentContext = (_input: Record<string, unknown>, { signal }: { signal: AbortSignal }) =>
  requestJson<PaymentContext>("/context", { signal });

const recordGuardEvent = (event: GuardEvent) => {
  const summary = {
    name: event.name,
    stage: event.stage,
    invocationId: event.invocationId,
  };
  window.dispatchEvent(new CustomEvent("signett:event", { detail: summary }));
  const target = window as InstrumentedWindow;
  target.__signettGuardEvents ??= [];
  target.__signettGuardEvents.push(summary);
};

export function registerPaymentTools(onPaymentCreated: (transactionId: string) => void) {
  const registration = new AbortController();
  const modelContext = document.modelContext;
  if (!modelContext) return registration;

  const idempotencyStore = new MemoryIdempotencyStore();
  const operationJournal = new MemoryOperationJournal();
  const copy = toolCopy();

  const searchUsers = async (
    input: ToolInput<{ query: string }>,
    { signal }: { signal: AbortSignal }
  ) =>
    requestJson<{ users: Array<{ id: string; username: string; displayName: string }> }>(
      `/payment-users?q=${encodeURIComponent(input.query)}`,
      { signal }
    );

  const listAccounts = async (_input: Record<string, never>, { signal }: { signal: AbortSignal }) =>
    requestJson<PaymentContext>("/context", { signal });

  const guardedSearchUsers = guard(searchUsers, {
    name: "search_payment_users",
    observe: recordGuardEvent,
  });
  const guardedListAccounts = guard(listAccounts, {
    name: "list_payment_accounts",
    observe: recordGuardEvent,
  });

  const executeSearchUsers: WebMCP.ToolExecuteCallback = (input, options) =>
    ((window as InstrumentedWindow).__webMcpBenchmarkMode === "raw"
      ? searchUsers
      : guardedSearchUsers)(input as ToolInput<{ query: string }>, {
      signal: executionSignal(options),
    });

  const executeListAccounts: WebMCP.ToolExecuteCallback = (input, options) =>
    ((window as InstrumentedWindow).__webMcpBenchmarkMode === "raw"
      ? listAccounts
      : guardedListAccounts)(input as Record<string, never>, { signal: executionSignal(options) });

  const paymentHandler = async (input: SendPaymentInput, { signal, operation }: ExecuteOptions) => {
    await operation?.write({ operationId: input.operationId });
    const result = await requestJson<PaymentResponse>("/payments", {
      method: "POST",
      signal,
      body: JSON.stringify(input),
    });
    onPaymentCreated(result.transaction.id);
    return result;
  };

  const guardedPaymentHandler = guard<SendPaymentInput, PaymentResponse, PaymentContext>(
    paymentHandler,
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
      journal: { store: operationJournal },
      recover: async ({ input, context, operation, signal }) => {
        const correlation = await operation?.read<{ operationId: string }>();
        if (correlation?.operationId !== input.operationId) return { recovered: false };
        try {
          const authoritative = await requestJson<AuthoritativePayment>(
            `/payments/${encodeURIComponent(input.operationId)}`,
            { signal }
          );
          if (!matchesPayment(authoritative, input, context)) {
            await operation?.remove();
            return { recovered: false };
          }
          onPaymentCreated(authoritative.transaction.id);
          return { recovered: true, output: { ...authoritative, replayed: true } };
        } catch (error) {
          if (error instanceof Error && "status" in error && error.status === 404) {
            await operation?.remove();
          }
          return { recovered: false };
        }
      },
      verify: async ({ input, output, context, signal }) => {
        const authoritative = await requestJson<AuthoritativePayment>(
          `/payments/${encodeURIComponent(input.operationId)}`,
          { signal }
        );
        const verified =
          authoritative.operation.transactionId === output.transaction.id &&
          matchesPayment(authoritative, input, context);

        return verified
          ? true
          : { verified: false, reason: "Authoritative payment state did not match the request." };
      },
      observe: recordGuardEvent,
    }
  );

  // Chrome's experimental implementation currently calls imperative tool
  // handlers without the optional execution-options argument. Preserve a
  // native AbortSignal when supplied while keeping the guarded handler usable
  // in builds that omit it.
  const executeSendPayment: WebMCP.ToolExecuteCallback = (input, options) => {
    const execute =
      (window as InstrumentedWindow).__webMcpBenchmarkMode === "raw"
        ? paymentHandler
        : guardedPaymentHandler;
    return execute(input as SendPaymentInput, { signal: executionSignal(options) });
  };

  const registrations = [
    modelContext.registerTool(
      {
        name: "search_payment_users",
        title: "Search payment recipients",
        description: copy.search,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              ...(copy.query ? { description: copy.query } : {}),
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        execute: executeSearchUsers,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
      },
      { signal: registration.signal }
    ),
    modelContext.registerTool(
      {
        name: "list_payment_accounts",
        title: "List payment source accounts",
        description: copy.accounts,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: executeListAccounts,
        annotations: { readOnlyHint: true },
      },
      { signal: registration.signal }
    ),
    modelContext.registerTool(
      {
        name: "send_payment",
        title: "Send a payment",
        description: copy.payment,
        inputSchema: {
          type: "object",
          properties: {
            operationId: {
              type: "string",
              pattern: "^[A-Za-z0-9._:-]{1,128}$",
              maxLength: 128,
              ...(copy.operationId ? { description: copy.operationId } : {}),
            },
            sourceAccountId: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              ...(copy.sourceAccountId ? { description: copy.sourceAccountId } : {}),
            },
            receiverId: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              ...(copy.receiverId ? { description: copy.receiverId } : {}),
            },
            amount: {
              type: "number",
              exclusiveMinimum: 0,
              maximum: 10000,
              multipleOf: 0.01,
              ...(copy.amount ? { description: copy.amount } : {}),
            },
            description: {
              type: "string",
              minLength: 1,
              maxLength: 140,
              ...(copy.description ? { description: copy.description } : {}),
            },
          },
          required: ["operationId", "sourceAccountId", "receiverId", "amount", "description"],
          additionalProperties: false,
        },
        execute: executeSendPayment,
      },
      { signal: registration.signal }
    ),
  ];

  void Promise.all(registrations).catch((error: unknown) => {
    console.error("Failed to register payment tools", error);
  });

  registration.signal.addEventListener(
    "abort",
    () => {
      idempotencyStore.clear();
      operationJournal.clear();
    },
    { once: true }
  );
  return registration;
}
