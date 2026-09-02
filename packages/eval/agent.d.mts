export interface WebMcpTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: object | string;
  readonly annotations?: Readonly<Record<string, unknown>>;
  readonly origin?: string;
}

export interface AgentTask {
  readonly id: string;
  readonly prompt: string;
  readonly budgets?: {
    readonly timeoutMs?: number;
    readonly toolTimeoutMs?: number;
    readonly maxSteps?: number;
    readonly maxToolCalls?: number;
    readonly maxResultChars?: number;
  };
  readonly expectations?: {
    readonly requiredTools?: readonly string[];
    readonly forbiddenTools?: readonly string[];
    readonly maxToolErrors?: number;
  };
  readonly [key: string]: unknown;
}

export interface AgentApplicationAdapter {
  readonly id: string;
  readonly url: string | ((context: unknown) => string | Promise<string>);
  readonly browser?: Readonly<Record<string, unknown>>;
  readonly recordPayloads?: boolean;
  prepare?(context: unknown): unknown;
  reset?(context: unknown): unknown;
  snapshot?(context: unknown): unknown;
  establishSession?(context: unknown): unknown;
  runtimeEvidence?(context: unknown): unknown;
  grade?(context: unknown): unknown;
  cleanup?(context: unknown): unknown;
}

export interface AgentTestSuite {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly application: AgentApplicationAdapter;
  readonly tasks: readonly AgentTask[];
  readonly provider?: {
    readonly endpoint?: string;
    readonly model?: string;
    readonly apiKeyEnv?: string;
  };
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly createComplete?: (context: unknown) => unknown;
}

export interface AgentCompletionInput {
  readonly messages: readonly Record<string, unknown>[];
  readonly tools: readonly Record<string, unknown>[];
  readonly signal: AbortSignal;
}

export interface HeadlessEvidence {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly runner: "@signet/eval";
  readonly status: "passed" | "failed" | "timed_out";
  readonly durationMs: number;
  readonly task: Readonly<Record<string, unknown>>;
  readonly application: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly inventory: Readonly<Record<string, unknown>>;
  readonly agent: Readonly<Record<string, unknown>> | null;
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly grade: Readonly<Record<string, unknown>>;
  readonly error?: Readonly<Record<string, unknown>>;
  readonly runtime?: unknown;
  readonly redaction: Readonly<Record<string, unknown>>;
}

export const AGENT_TEST_SCHEMA_VERSION: 1;
export const HEADLESS_EVIDENCE_SCHEMA_VERSION: 1;
export function defineAgentTestSuite(
  definition: AgentTestSuite,
): AgentTestSuite;
export function validateTask(task: AgentTask): AgentTask;
export function providerTools(
  tools: readonly WebMcpTool[],
): readonly Record<string, unknown>[];
export function runAgent(options: Record<string, unknown>): Promise<{
  readonly answer: string;
  readonly calls: readonly Record<string, unknown>[];
  readonly messages: readonly Record<string, unknown>[];
}>;
export function createChatCompletionsProvider(
  config: {
    readonly endpoint: string;
    readonly model: string;
    readonly apiKey?: string;
  },
  fetchImpl?: typeof fetch,
): (input: AgentCompletionInput) => Promise<unknown>;
export function endpointOriginPattern(endpoint: string): string;
export function launchHeadlessWebMcpPage(
  options: Record<string, unknown>,
): Promise<unknown>;
export function findChrome(): string | undefined;
export function runHeadlessTest(options: {
  readonly task: AgentTask;
  readonly application: AgentApplicationAdapter;
  readonly complete: (input: AgentCompletionInput) => Promise<unknown>;
  readonly browserFactory?: (
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly outputPath?: string;
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}): Promise<HeadlessEvidence>;
export function interfaceGrade(
  options: Record<string, unknown>,
): Readonly<Record<string, unknown>>;
export class HeadlessWebMcpPage {
  listTools(): Promise<WebMcpTool[]>;
  invoke(options: Record<string, unknown>): Promise<unknown>;
  abort(callId: string): Promise<boolean>;
  pageInfo(): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  close(): void;
}
