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

export interface EvaluationCondition {
  readonly id: string;
  readonly description?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface TrialContext {
  readonly id: string;
  readonly trialId: string;
  readonly index: number;
  readonly caseDefinition: SignetCase;
  readonly condition: EvaluationCondition;
  readonly outputDir?: string;
  readonly signal: AbortSignal;
  readonly artifacts: Record<string, unknown>[];
  emit(type: string, detail?: Record<string, unknown>): void;
}

export interface ApplicationAdapter {
  readonly id: string;
  readonly version?: string;
  prepare?(context: Record<string, unknown>): Promise<void>;
  reset(context: TrialContext): Promise<void>;
  entrypoint(context: TrialContext): Promise<string> | string;
  cleanup?(context: Record<string, unknown>): Promise<void>;
}

export interface BrowserAdapter<Session = unknown> {
  readonly id: string;
  readonly version?: string;
  open(context: TrialContext & { readonly url: string }): Promise<Session>;
  inventory(context: TrialContext & { readonly session: Session }): Promise<Record<string, unknown>[]>;
  close?(context: TrialContext & { readonly session: Session }): Promise<void>;
}

export interface AgentAdapter<Session = unknown> {
  readonly id: string;
  readonly version?: string;
  readonly provider?: string;
  readonly model?: string;
  run(context: TrialContext & {
    readonly session: Session;
    readonly inventory: readonly Record<string, unknown>[];
  }): Promise<Record<string, unknown>>;
}

export interface FaultAdapter<Session = unknown> {
  readonly id: string;
  readonly version?: string;
  arm(context: TrialContext & { readonly session: Session }): Promise<void>;
  disarm(context: TrialContext & { readonly session: Session }): Promise<void>;
}

export interface OracleGrade {
  readonly authoritativeSuccess: boolean;
  readonly safeSuccess: boolean;
  readonly forbiddenEffects: readonly string[];
  readonly components?: Readonly<Record<string, unknown>>;
}

export interface OracleAdapter {
  readonly id: string;
  readonly version?: string;
  snapshot(context: TrialContext & { readonly phase: string }): Promise<unknown>;
  grade(context: TrialContext & {
    readonly before: unknown;
    readonly after: unknown;
    readonly agent: Readonly<Record<string, unknown>>;
    readonly inventory: readonly Record<string, unknown>[];
    readonly events: readonly Record<string, unknown>[];
  }): Promise<OracleGrade>;
}

export interface EvaluationDefinition {
  readonly suite: SignetSuite;
  readonly conditions?: readonly EvaluationCondition[];
  readonly adapters: {
    readonly application: ApplicationAdapter;
    readonly browser: BrowserAdapter;
    readonly agent: AgentAdapter;
    readonly oracle: OracleAdapter;
    readonly faults?: readonly FaultAdapter[];
  };
}

export function defineEvaluation(definition: EvaluationDefinition): EvaluationDefinition & {
  readonly conditions: readonly EvaluationCondition[];
};
export function validateAdapter(kind: string, adapter: unknown): object;
export function classifyFailure(error: unknown, timedOut?: boolean): TrialEvidence["failure"];
export function runTrial(input: {
  readonly caseDefinition: SignetCase;
  readonly condition: EvaluationCondition;
  readonly index: number;
  readonly adapters: EvaluationDefinition["adapters"];
  readonly outputDir?: string;
  readonly provenance?: Record<string, unknown>;
  readonly trialId?: string;
}): Promise<TrialEvidence>;
