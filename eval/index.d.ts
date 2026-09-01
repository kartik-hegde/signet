export type CaseKind =
  | "read"
  | "mutation"
  | "multi_step"
  | "consequential"
  | "recovery"
  | "negative";

export interface CaseBudgets {
  readonly timeoutMs?: number;
  readonly maxActions?: number;
  readonly maxToolCalls?: number;
}

export interface CaseExpectations<Expected = Record<string, unknown>> {
  readonly requiredCapabilities?: readonly string[];
  readonly completionCapability?: string;
  readonly outcome?: Expected;
  readonly forbiddenEffects?: readonly string[];
}

export interface SignetCase<
  Parameters extends Record<string, unknown> = Record<string, unknown>,
  Expected = Record<string, unknown>,
> {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly intent: string;
  readonly kind: CaseKind;
  readonly application: string;
  readonly oracle: string;
  readonly tags?: readonly string[];
  readonly entrypoint?: string;
  readonly faults?: readonly string[];
  readonly parameters?: Parameters;
  readonly expectations: CaseExpectations<Expected>;
  readonly budgets?: CaseBudgets;
}

export interface SignetCaseInput<
  Parameters extends Record<string, unknown> = Record<string, unknown>,
  Expected = Record<string, unknown>,
> extends Omit<SignetCase<Parameters, Expected>, "schemaVersion"> {
  readonly schemaVersion?: 1;
}

export interface SignetSuite {
  readonly id: string;
  readonly cases: readonly SignetCase[];
  readonly description?: string;
}

export const CASE_SCHEMA_VERSION: 1;
export function defineCase<
  Parameters extends Record<string, unknown> = Record<string, unknown>,
  Expected = Record<string, unknown>,
>(definition: SignetCaseInput<Parameters, Expected>): SignetCase<Parameters, Expected>;
export function defineSuite(definition: SignetSuite): SignetSuite;
export function validateCase(value: unknown): SignetCase;

export type TrialStatus =
  | "completed"
  | "failed"
  | "timed_out"
  | "environment_error";
export type FailureCategory =
  | "environment"
  | "registration"
  | "selection"
  | "arguments"
  | "application"
  | "execution_control"
  | "verification"
  | "oracle"
  | "agent_provider";

export interface TrialEvidence {
  readonly schemaVersion: 1;
  readonly evidenceId: string;
  readonly generatedAt: string;
  readonly case: {
    readonly id: string;
    readonly definitionHash: string;
    readonly intent: string;
    readonly kind: CaseKind;
  };
  readonly trial: {
    readonly id: string;
    readonly index: number;
    readonly condition: string;
    readonly startedAt: string;
    readonly durationMs: number;
    readonly status: TrialStatus;
  };
  readonly provenance: Record<string, unknown>;
  readonly inventory: readonly Record<string, unknown>[];
  readonly events: readonly Record<string, unknown>[];
  readonly agent: Record<string, unknown>;
  readonly oracle: {
    readonly adapter: string;
    readonly before?: unknown;
    readonly after?: unknown;
    readonly grade: {
      readonly authoritativeSuccess: boolean;
      readonly safeSuccess: boolean;
      readonly forbiddenEffects: readonly string[];
      readonly components?: Record<string, unknown>;
    };
  };
  readonly failure?: {
    readonly category: FailureCategory;
    readonly message: string;
    readonly stage?: string;
    readonly retryable?: boolean;
  };
  readonly artifacts: readonly Record<string, unknown>[];
  readonly redaction: {
    readonly policy: string;
    readonly version: number;
    readonly containsSensitiveData: boolean;
  };
}

export const EVIDENCE_SCHEMA_VERSION: 1;
export const TRIAL_STATUSES: readonly TrialStatus[];
export const FAILURE_CATEGORIES: readonly FailureCategory[];
export function hashCase(caseDefinition: SignetCase): string;
export function createEvidence(input: {
  readonly evidenceId?: string;
  readonly generatedAt?: string;
  readonly caseDefinition: SignetCase;
  readonly trial: TrialEvidence["trial"];
  readonly provenance: TrialEvidence["provenance"];
  readonly inventory?: TrialEvidence["inventory"];
  readonly events?: TrialEvidence["events"];
  readonly agent: TrialEvidence["agent"];
  readonly oracle: TrialEvidence["oracle"];
  readonly failure?: TrialEvidence["failure"];
  readonly artifacts?: TrialEvidence["artifacts"];
  readonly redaction?: TrialEvidence["redaction"];
}): TrialEvidence;
export function validateEvidence(value: unknown): TrialEvidence;
