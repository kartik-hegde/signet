/// <reference types="webmcp-types" />

import {
  ToolError,
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
  authorizationId?: string;
}>;

type PreparePaymentAuthorizationInput = ToolInput<{
  operationId: string;
  sourceAccountId: string;
  receiverId: string;
  amount: number;
  description: string;
}>;

type PaymentStateDependency = "source" | "recipient" | "quote" | "compliance";

type PaymentAuthorization = PreparePaymentAuthorizationInput & {
  authorizationId: string;
  status: "active" | "expired" | "consumed";
  sequence: number;
  accountStateVersion: number;
  recipientStateVersion: number;
  quoteStateVersion: number;
  complianceStateVersion: number;
};

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
  __signettRepairFault?: {
    expireFirstPaymentAuthorization?: boolean;
    staleTargetsAfterReplacementAuthorization?: PaymentStateDependency[];
    loseCommittedPaymentResponse?: boolean;
  };
  __signettRepairState?: {
    authorizationSequence: number;
    accountStateVersion: number;
    recipientStateVersion: number;
    quoteStateVersion: number;
    complianceStateVersion: number;
    requiredAccountStateVersion: number;
    requiredRecipientStateVersion: number;
    requiredQuoteStateVersion: number;
    requiredComplianceStateVersion: number;
    nextStalenessIndex: number;
    outcomeResponseLost: boolean;
    paymentAuthorizations: Map<string, PaymentAuthorization>;
  };
};

type MetadataVariant = "baseline" | "explicit" | "guided";

const metadataVariant = (): MetadataVariant => {
  const value = window.localStorage.getItem("signett:eval:metadata");
  return value === "explicit" || value === "guided" ? value : "baseline";
};

const repairScenarioEnabled = () =>
  window.localStorage.getItem("signett:eval:scenario")?.startsWith("payment-") ?? false;

class PaymentAuthorizationExpiredError extends Error {
  constructor() {
    super("The payment authorization expired before the payment was created.");
    this.name = "PaymentAuthorizationExpiredError";
  }
}

class PaymentSourceStaleError extends Error {
  constructor() {
    super("The payment authorization no longer matches current application state.");
    this.name = "PaymentSourceStaleError";
  }
}

class PaymentRecipientStaleError extends Error {
  constructor() {
    super("The payment authorization no longer matches current application state.");
    this.name = "PaymentRecipientStaleError";
  }
}

class PaymentQuoteStaleError extends Error {
  constructor() {
    super("The payment authorization no longer matches current application state.");
    this.name = "PaymentQuoteStaleError";
  }
}

class PaymentComplianceStaleError extends Error {
  constructor() {
    super("The payment authorization no longer matches current application state.");
    this.name = "PaymentComplianceStaleError";
  }
}

class PaymentOutcomeUnknownError extends Error {
  constructor() {
    super("The payment request ended without a usable response; its outcome is unknown.");
    this.name = "PaymentOutcomeUnknownError";
  }
}

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
  const repairScenario = repairScenarioEnabled();
  const instrumentedWindow = window as InstrumentedWindow;
  instrumentedWindow.__signettRepairState ??= {
    authorizationSequence: 0,
    accountStateVersion: 0,
    recipientStateVersion: 0,
    quoteStateVersion: 0,
    complianceStateVersion: 0,
    requiredAccountStateVersion: 0,
    requiredRecipientStateVersion: 0,
    requiredQuoteStateVersion: 0,
    requiredComplianceStateVersion: 0,
    nextStalenessIndex: 0,
    outcomeResponseLost: false,
    paymentAuthorizations: new Map<string, PaymentAuthorization>(),
  };
  const repairState = instrumentedWindow.__signettRepairState;

  const searchUsers = async (
    input: ToolInput<{ query: string }>,
    { signal }: { signal: AbortSignal }
  ) => {
    const result = await requestJson<{
      users: Array<{ id: string; username: string; displayName: string }>;
    }>(`/payment-users?q=${encodeURIComponent(input.query)}`, { signal });
    if (!repairScenario) return result;
    repairState.recipientStateVersion += 1;
    return { ...result, recipientStateVersion: repairState.recipientStateVersion };
  };

  const listAccounts = async (
    _input: Record<string, never>,
    { signal }: { signal: AbortSignal }
  ) => {
    const context = await requestJson<PaymentContext>("/context", { signal });
    if (!repairScenario) return context;
    repairState.accountStateVersion += 1;
    return { ...context, accountStateVersion: repairState.accountStateVersion };
  };

  const refreshPaymentQuote = async (
    input: ToolInput<{ receiverId: string; amount: number }>,
    { signal }: { signal: AbortSignal }
  ) => {
    signal.throwIfAborted();
    repairState.quoteStateVersion += 1;
    return {
      receiverId: input.receiverId,
      amount: input.amount,
      fee: 0,
      currency: "USD",
      quoteStateVersion: repairState.quoteStateVersion,
    };
  };

  const checkPaymentCompliance = async (
    input: ToolInput<{ sourceAccountId: string; receiverId: string; amount: number }>,
    { signal }: { signal: AbortSignal }
  ) => {
    signal.throwIfAborted();
    repairState.complianceStateVersion += 1;
    return {
      sourceAccountId: input.sourceAccountId,
      receiverId: input.receiverId,
      amount: input.amount,
      eligible: true,
      complianceStateVersion: repairState.complianceStateVersion,
    };
  };

  const getPaymentStatus = async (
    input: ToolInput<{ operationId: string }>,
    { signal }: { signal: AbortSignal }
  ) =>
    requestJson<Omit<PaymentResponse, "replayed">>(
      `/payments/${encodeURIComponent(input.operationId)}`,
      { signal }
    );

  const guardedSearchUsers = guard(searchUsers, {
    name: "search_payment_users",
    observe: recordGuardEvent,
  });
  const guardedListAccounts = guard(listAccounts, {
    name: "list_payment_accounts",
    observe: recordGuardEvent,
  });
  const guardedRefreshPaymentQuote = guard(refreshPaymentQuote, {
    name: "refresh_payment_quote",
    observe: recordGuardEvent,
  });
  const guardedCheckPaymentCompliance = guard(checkPaymentCompliance, {
    name: "check_payment_compliance",
    observe: recordGuardEvent,
  });
  const guardedGetPaymentStatus = guard(getPaymentStatus, {
    name: "get_payment_status",
    observe: recordGuardEvent,
  });

  const preparePaymentAuthorization = async (
    input: PreparePaymentAuthorizationInput,
    { signal }: { signal: AbortSignal }
  ) => {
    signal.throwIfAborted();
    repairState.authorizationSequence += 1;
    const authorization: PaymentAuthorization = {
      ...input,
      authorizationId: `payauth-${repairState.authorizationSequence}-${input.operationId}`,
      status: "active",
      sequence: repairState.authorizationSequence,
      accountStateVersion: repairState.accountStateVersion,
      recipientStateVersion: repairState.recipientStateVersion,
      quoteStateVersion: repairState.quoteStateVersion,
      complianceStateVersion: repairState.complianceStateVersion,
    };
    repairState.paymentAuthorizations.set(authorization.authorizationId, authorization);
    return {
      authorizationId: authorization.authorizationId,
      operationId: authorization.operationId,
      status: authorization.status,
      expiresInSeconds: 30,
    };
  };

  const guardedPreparePaymentAuthorization = guard(preparePaymentAuthorization, {
    name: "prepare_payment_authorization",
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

  const executeRefreshPaymentQuote: WebMCP.ToolExecuteCallback = (input, options) =>
    ((window as InstrumentedWindow).__webMcpBenchmarkMode === "raw"
      ? refreshPaymentQuote
      : guardedRefreshPaymentQuote)(input as ToolInput<{ receiverId: string; amount: number }>, {
      signal: executionSignal(options),
    });

  const executeCheckPaymentCompliance: WebMCP.ToolExecuteCallback = (input, options) =>
    ((window as InstrumentedWindow).__webMcpBenchmarkMode === "raw"
      ? checkPaymentCompliance
      : guardedCheckPaymentCompliance)(
      input as ToolInput<{ sourceAccountId: string; receiverId: string; amount: number }>,
      { signal: executionSignal(options) }
    );

  const executeGetPaymentStatus: WebMCP.ToolExecuteCallback = (input, options) =>
    ((window as InstrumentedWindow).__webMcpBenchmarkMode === "raw"
      ? getPaymentStatus
      : guardedGetPaymentStatus)(input as ToolInput<{ operationId: string }>, {
      signal: executionSignal(options),
    });

  const paymentHandler = async (input: SendPaymentInput, { signal, operation }: ExecuteOptions) => {
    await operation?.write({ operationId: input.operationId });
    if (repairScenario) {
      const authorization = repairState.paymentAuthorizations.get(input.authorizationId ?? "");
      const authorizationMatches =
        authorization &&
        authorization.operationId === input.operationId &&
        authorization.sourceAccountId === input.sourceAccountId &&
        authorization.receiverId === input.receiverId &&
        authorization.amount === input.amount &&
        authorization.description === input.description;
      if (!authorizationMatches) {
        throw new Error("A current payment authorization matching this exact payment is required.");
      }
      if (
        authorization.status === "expired" ||
        (authorization.sequence === 1 &&
          (window as InstrumentedWindow).__signettRepairFault?.expireFirstPaymentAuthorization)
      ) {
        authorization.status = "expired";
        throw new PaymentAuthorizationExpiredError();
      }
      if (authorization.accountStateVersion < repairState.requiredAccountStateVersion) {
        throw new PaymentSourceStaleError();
      }
      if (authorization.recipientStateVersion < repairState.requiredRecipientStateVersion) {
        throw new PaymentRecipientStaleError();
      }
      if (authorization.quoteStateVersion < repairState.requiredQuoteStateVersion) {
        throw new PaymentQuoteStaleError();
      }
      if (authorization.complianceStateVersion < repairState.requiredComplianceStateVersion) {
        throw new PaymentComplianceStaleError();
      }
      const staleTargets =
        instrumentedWindow.__signettRepairFault?.staleTargetsAfterReplacementAuthorization ?? [];
      const staleTarget = staleTargets[repairState.nextStalenessIndex];
      if (authorization.sequence > 1 && staleTarget) {
        repairState.nextStalenessIndex += 1;
        if (staleTarget === "source") {
          repairState.requiredAccountStateVersion = repairState.accountStateVersion + 1;
          throw new PaymentSourceStaleError();
        }
        if (staleTarget === "recipient") {
          repairState.requiredRecipientStateVersion = repairState.recipientStateVersion + 1;
          throw new PaymentRecipientStaleError();
        }
        if (staleTarget === "quote") {
          repairState.requiredQuoteStateVersion = repairState.quoteStateVersion + 1;
          throw new PaymentQuoteStaleError();
        }
        repairState.requiredComplianceStateVersion = repairState.complianceStateVersion + 1;
        throw new PaymentComplianceStaleError();
      }
      if (authorization.status !== "active") {
        throw new Error("The payment authorization is no longer active.");
      }
      authorization.status = "consumed";
    }

    const { authorizationId: _authorizationId, ...paymentInput } = input;
    const result = await requestJson<PaymentResponse>("/payments", {
      method: "POST",
      signal,
      body: JSON.stringify(paymentInput),
    });
    onPaymentCreated(result.transaction.id);
    if (
      repairScenario &&
      instrumentedWindow.__signettRepairFault?.loseCommittedPaymentResponse &&
      !repairState.outcomeResponseLost
    ) {
      repairState.outcomeResponseLost = true;
      throw new PaymentOutcomeUnknownError();
    }
    return result;
  };

  const signettPaymentHandler = async (input: SendPaymentInput, options: ExecuteOptions) => {
    try {
      return await paymentHandler(input, options);
    } catch (error) {
      if (error instanceof PaymentAuthorizationExpiredError) {
        throw new ToolError({
          code: "payment_authorization_expired",
          message: error.message,
          retryable: true,
          retry: "after_repair",
          repair: {
            steps: [
              {
                action: "call_tool",
                tool: "prepare_payment_authorization",
                instruction: "Create a replacement authorization.",
              },
              {
                action: "retry_same_operation",
                tool: "send_payment",
                instruction: "Retry the original payment.",
              },
            ],
            preserve: ["operationId", "sourceAccountId", "receiverId", "amount", "description"],
            update: ["authorizationId"],
          },
        });
      }
      if (error instanceof PaymentSourceStaleError) {
        throw new ToolError({
          code: "payment_source_stale",
          message: error.message,
          retryable: true,
          retry: "after_repair",
          repair: {
            steps: [
              {
                action: "call_tool",
                tool: "list_payment_accounts",
                instruction: "Refresh the source account state.",
              },
              {
                action: "call_tool",
                tool: "prepare_payment_authorization",
                instruction: "Create a replacement authorization from the refreshed state.",
              },
              {
                action: "retry_same_operation",
                tool: "send_payment",
                instruction: "Retry the original payment.",
              },
            ],
            preserve: ["operationId", "sourceAccountId", "receiverId", "amount", "description"],
            update: ["authorizationId"],
          },
        });
      }
      if (error instanceof PaymentRecipientStaleError) {
        throw new ToolError({
          code: "payment_recipient_stale",
          message: error.message,
          retryable: true,
          retry: "after_repair",
          repair: {
            steps: [
              {
                action: "call_tool",
                tool: "search_payment_users",
                instruction: "Refresh the recipient state.",
              },
              {
                action: "call_tool",
                tool: "prepare_payment_authorization",
                instruction: "Create a replacement authorization from the refreshed state.",
              },
              {
                action: "retry_same_operation",
                tool: "send_payment",
                instruction: "Retry the original payment.",
              },
            ],
            preserve: ["operationId", "sourceAccountId", "receiverId", "amount", "description"],
            update: ["authorizationId"],
          },
        });
      }
      if (error instanceof PaymentQuoteStaleError) {
        throw new ToolError({
          code: "payment_quote_stale",
          message: error.message,
          retry: "after_repair",
          repair: {
            steps: [
              {
                action: "call_tool",
                tool: "refresh_payment_quote",
                instruction: "Refresh the payment quote.",
              },
              {
                action: "call_tool",
                tool: "prepare_payment_authorization",
                instruction: "Create a replacement authorization from the refreshed state.",
              },
              {
                action: "retry_same_operation",
                tool: "send_payment",
                instruction: "Retry the original payment.",
              },
            ],
            preserve: ["operationId", "sourceAccountId", "receiverId", "amount", "description"],
            update: ["authorizationId"],
          },
        });
      }
      if (error instanceof PaymentComplianceStaleError) {
        throw new ToolError({
          code: "payment_compliance_stale",
          message: error.message,
          retry: "after_repair",
          repair: {
            steps: [
              {
                action: "call_tool",
                tool: "check_payment_compliance",
                instruction: "Refresh the payment compliance decision.",
              },
              {
                action: "call_tool",
                tool: "prepare_payment_authorization",
                instruction: "Create a replacement authorization from the refreshed state.",
              },
              {
                action: "retry_same_operation",
                tool: "send_payment",
                instruction: "Retry the original payment.",
              },
            ],
            preserve: ["operationId", "sourceAccountId", "receiverId", "amount", "description"],
            update: ["authorizationId"],
          },
        });
      }
      if (error instanceof PaymentOutcomeUnknownError) {
        throw new ToolError({
          code: "payment_outcome_unknown",
          message: error.message,
          retry: "never",
          repair: {
            steps: [
              {
                action: "reconcile",
                tool: "get_payment_status",
                instruction:
                  "Read authoritative payment status with the original operationId before deciding whether any retry is safe.",
              },
            ],
            preserve: ["operationId"],
            update: [],
          },
        });
      }
      throw error;
    }
  };

  const guardedPaymentHandler = guard<SendPaymentInput, PaymentResponse, PaymentContext>(
    signettPaymentHandler,
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
    ...(repairScenario
      ? [
          modelContext.registerTool(
            {
              name: "prepare_payment_authorization",
              title: "Prepare payment authorization",
              description:
                "Create a short-lived authorization for one exact payment before calling send_payment. Quote and compliance refreshes are not prerequisites for the first attempt; use them only when failure feedback requests them.",
              inputSchema: {
                type: "object",
                properties: {
                  operationId: {
                    type: "string",
                    pattern: "^[A-Za-z0-9._:-]{1,128}$",
                    description:
                      "Stable ID for the intended payment; keep it unchanged throughout recovery.",
                  },
                  sourceAccountId: {
                    type: "string",
                    minLength: 1,
                    description: "Account ID returned by list_payment_accounts.",
                  },
                  receiverId: {
                    type: "string",
                    minLength: 1,
                    description: "Recipient ID returned by search_payment_users.",
                  },
                  amount: {
                    type: "number",
                    exclusiveMinimum: 0,
                    maximum: 10000,
                    multipleOf: 0.01,
                    description: "Payment amount in dollars.",
                  },
                  description: {
                    type: "string",
                    minLength: 1,
                    maxLength: 140,
                    description: "Exact payment note.",
                  },
                },
                required: ["operationId", "sourceAccountId", "receiverId", "amount", "description"],
                additionalProperties: false,
              },
              execute: (input, options) =>
                ((window as InstrumentedWindow).__webMcpBenchmarkMode === "raw"
                  ? preparePaymentAuthorization
                  : guardedPreparePaymentAuthorization)(input as PreparePaymentAuthorizationInput, {
                  signal: executionSignal(options),
                }),
            },
            { signal: registration.signal }
          ),
          modelContext.registerTool(
            {
              name: "refresh_payment_quote",
              title: "Refresh payment quote",
              description:
                "Repair payment_quote_stale by refreshing quote and fee state. Do not call before the first payment attempt or for other failures.",
              inputSchema: {
                type: "object",
                properties: {
                  receiverId: {
                    type: "string",
                    minLength: 1,
                    description: "Recipient ID returned by search_payment_users.",
                  },
                  amount: {
                    type: "number",
                    exclusiveMinimum: 0,
                    maximum: 10000,
                    multipleOf: 0.01,
                    description: "Payment amount in dollars.",
                  },
                },
                required: ["receiverId", "amount"],
                additionalProperties: false,
              },
              execute: executeRefreshPaymentQuote,
              annotations: { readOnlyHint: true },
            },
            { signal: registration.signal }
          ),
          modelContext.registerTool(
            {
              name: "check_payment_compliance",
              title: "Check payment compliance",
              description:
                "Repair payment_compliance_stale by refreshing the compliance decision. Do not call before the first payment attempt or for other failures.",
              inputSchema: {
                type: "object",
                properties: {
                  sourceAccountId: {
                    type: "string",
                    minLength: 1,
                    description: "Account ID returned by list_payment_accounts.",
                  },
                  receiverId: {
                    type: "string",
                    minLength: 1,
                    description: "Recipient ID returned by search_payment_users.",
                  },
                  amount: {
                    type: "number",
                    exclusiveMinimum: 0,
                    maximum: 10000,
                    multipleOf: 0.01,
                    description: "Payment amount in dollars.",
                  },
                },
                required: ["sourceAccountId", "receiverId", "amount"],
                additionalProperties: false,
              },
              execute: executeCheckPaymentCompliance,
              annotations: { readOnlyHint: true },
            },
            { signal: registration.signal }
          ),
          modelContext.registerTool(
            {
              name: "get_payment_status",
              title: "Get payment status",
              description:
                "Reconcile payment_outcome_unknown by reading authoritative state. Do not use for a failure proven to occur before payment creation.",
              inputSchema: {
                type: "object",
                properties: {
                  operationId: {
                    type: "string",
                    pattern: "^[A-Za-z0-9._:-]{1,128}$",
                    description: "Operation ID of the intended payment.",
                  },
                },
                required: ["operationId"],
                additionalProperties: false,
              },
              execute: executeGetPaymentStatus,
              annotations: { readOnlyHint: true },
            },
            { signal: registration.signal }
          ),
        ]
      : []),
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
            ...(repairScenario
              ? {
                  authorizationId: {
                    type: "string",
                    minLength: 1,
                    description:
                      "Active authorizationId returned by prepare_payment_authorization.",
                  },
                }
              : {}),
          },
          required: [
            "operationId",
            "sourceAccountId",
            "receiverId",
            "amount",
            "description",
            ...(repairScenario ? ["authorizationId"] : []),
          ],
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
