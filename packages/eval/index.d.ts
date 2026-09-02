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

export const CASE_KINDS: readonly CaseKind[];
export const CASE_SCHEMA_VERSION: 1;
export function defineCase<
  Parameters extends Record<string, unknown> = Record<string, unknown>,
  Expected = Record<string, unknown>,
>(
  definition: SignetCaseInput<Parameters, Expected>,
): SignetCase<Parameters, Expected>;
export function defineSuite(definition: SignetSuite): SignetSuite;
export function validateCase(value: unknown): SignetCase;

export type TrialStatus =
  "completed" | "failed" | "timed_out" | "environment_error";
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

export interface QualityDimension {
  readonly applicable: boolean;
  readonly reason?: string;
}

export interface DiscoveryQuality extends QualityDimension {
  readonly expected: number;
  readonly available: number;
  readonly unavailableCapabilities: readonly string[];
  readonly complete: boolean | null;
}

export interface SelectionQuality extends QualityDimension {
  readonly requiredCapabilities: readonly string[];
  readonly completionCapability: string | null;
  readonly calledCapabilities: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly completionCapabilityCalled: boolean | null;
  readonly unknownToolCalls: readonly string[];
  readonly toolCalls: number;
  readonly accurate: boolean | null;
}

export interface ArgumentQuality extends QualityDimension {
  readonly evaluatedCalls: number;
  readonly validCalls: number;
  readonly invalidCalls: number;
  readonly validity: number | null;
  readonly accurate: boolean | null;
  readonly violations: readonly {
    readonly tool: string;
    readonly sequence: number;
    readonly problems: readonly string[];
  }[];
}

export interface ContinuationQuality extends QualityDimension {
  readonly toolErrors: number;
  readonly observedErrors: number;
  readonly continuedErrors: number;
  readonly continuationRate: number | null;
  readonly continued: boolean | null;
  readonly errorTools?: readonly string[];
}

export interface SurfaceQuality extends QualityDimension {
  readonly uiActions: number;
  readonly uiInspections: number;
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  readonly fullWebMcp: boolean | null;
  readonly uiFallback: boolean | null;
}

export interface BudgetQuality extends QualityDimension {
  readonly actions: number;
  readonly toolCalls: number;
  readonly maxActions?: number | null;
  readonly maxToolCalls?: number | null;
  readonly exceeded: boolean | null;
  readonly exceededBudgets: readonly string[];
}

export interface InterfaceQuality {
  readonly schemaVersion: 1;
  readonly source: "events" | "summary" | "none";
  readonly discovery: DiscoveryQuality;
  readonly selection: SelectionQuality;
  readonly arguments: ArgumentQuality;
  readonly continuation: ContinuationQuality;
  readonly surface: SurfaceQuality;
  readonly budgets: BudgetQuality;
}

export const INTERFACE_QUALITY_SCHEMA_VERSION: 1;
export const TRACE_EVENTS: {
  readonly toolCall: "webmcp_call";
  readonly uiAction: "ui_action";
  readonly uiInspection: "ui_inspection";
};
export function scoreInterfaceQuality(input: {
  readonly caseDefinition: SignetCase;
  readonly inventory?: readonly Record<string, unknown>[];
  readonly events?: readonly Record<string, unknown>[];
  readonly agent?: Record<string, unknown>;
  readonly status?: TrialStatus;
}): InterfaceQuality;
export function validateAgainstSchema(
  value: unknown,
  schema: unknown,
  path?: string,
): string[];

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
  readonly quality?: InterfaceQuality;
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
  readonly quality?: TrialEvidence["quality"];
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
  inventory(
    context: TrialContext & { readonly session: Session },
  ): Promise<Record<string, unknown>[]>;
  close?(context: TrialContext & { readonly session: Session }): Promise<void>;
}

export interface AgentAdapter<Session = unknown> {
  readonly id: string;
  readonly version?: string;
  readonly provider?: string;
  readonly model?: string;
  run(
    context: TrialContext & {
      readonly session: Session;
      readonly inventory: readonly Record<string, unknown>[];
    },
  ): Promise<Record<string, unknown>>;
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
  snapshot(
    context: TrialContext & { readonly phase: string },
  ): Promise<unknown>;
  grade(
    context: TrialContext & {
      readonly before: unknown;
      readonly after: unknown;
      readonly agent: Readonly<Record<string, unknown>>;
      readonly inventory: readonly Record<string, unknown>[];
      readonly events: readonly Record<string, unknown>[];
    },
  ): Promise<OracleGrade>;
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

export function defineEvaluation(
  definition: EvaluationDefinition,
): EvaluationDefinition & {
  readonly conditions: readonly EvaluationCondition[];
};
export function validateAdapter(kind: string, adapter: unknown): object;
export function classifyFailure(
  error: unknown,
  timedOut?: boolean,
): TrialEvidence["failure"];
export function runTrial(input: {
  readonly caseDefinition: SignetCase;
  readonly condition: EvaluationCondition;
  readonly index: number;
  readonly adapters: EvaluationDefinition["adapters"];
  readonly outputDir?: string;
  readonly provenance?: Record<string, unknown>;
  readonly trialId?: string;
}): Promise<TrialEvidence>;

export interface InterfaceQualityAggregate {
  readonly scoredTrials: number;
  readonly discovery: {
    readonly scoredTrials: number;
    readonly completeTrials: number;
    readonly completeRate: number | null;
    readonly unavailableCapabilities: Readonly<Record<string, number>>;
  };
  readonly selection: {
    readonly scoredTrials: number;
    readonly accurateTrials: number;
    readonly accuracy: number | null;
    readonly missingCapabilities: Readonly<Record<string, number>>;
    readonly unknownToolCalls: Readonly<Record<string, number>>;
  };
  readonly arguments: {
    readonly scoredTrials: number;
    readonly accurateTrials: number;
    readonly accuracy: number | null;
    readonly evaluatedCalls: number;
    readonly validCalls: number;
    readonly validity: number | null;
  };
  readonly continuation: {
    readonly scoredTrials: number;
    readonly toolErrors: number;
    readonly observedErrors: number;
    readonly continuedErrors: number;
    readonly continuationRate: number | null;
  };
  readonly surface: {
    readonly scoredTrials: number;
    readonly fullWebMcpTrials: number;
    readonly fullWebMcpRate: number | null;
    readonly uiFallbackTrials: number;
    readonly uiFallbackRate: number | null;
  };
  readonly budgets: {
    readonly scoredTrials: number;
    readonly exceededTrials: number;
    readonly exceededRate: number | null;
  };
}

export interface EvaluationAggregate {
  readonly trials: number;
  readonly authoritativeSuccesses: number;
  readonly authoritativeSuccessRate: number | null;
  readonly safeSuccesses: number;
  readonly safeSuccessRate: number | null;
  readonly medianDurationMs: number | null;
  readonly medianActions: number | null;
  readonly medianTokens: number | null;
  readonly timeouts: number;
  readonly environmentErrors: number;
  readonly forbiddenEffectCount: number;
  readonly failuresByCategory: Readonly<Record<string, number>>;
  readonly interfaceQuality: InterfaceQualityAggregate;
}

export interface EvaluationReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly suite: string;
  readonly grading: "authoritative application oracle";
  readonly baselineCondition: string | null;
  readonly warnings: readonly string[];
  readonly aggregate: EvaluationAggregate;
  readonly conditions: Readonly<Record<string, EvaluationAggregate>>;
  readonly cases: Readonly<Record<string, unknown>>;
  readonly comparisons: Readonly<Record<string, unknown>>;
  readonly evidenceIds: readonly string[];
}

export const REPORT_SCHEMA_VERSION: 1;
export function buildReport(input: {
  readonly suite: string | SignetSuite;
  readonly evidence: readonly TrialEvidence[];
  readonly baselineCondition?: string;
}): EvaluationReport;
export function renderMarkdownReport(report: EvaluationReport): string;
export function writeReport(input: {
  readonly suite: string | SignetSuite;
  readonly evidence: readonly TrialEvidence[];
  readonly outputDir: string;
  readonly baselineCondition?: string;
}): {
  readonly report: EvaluationReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
};

export interface ChangeCheckPolicy {
  readonly maxSafeRegression?: number;
  readonly maxAuthoritativeRegression?: number;
  readonly maxSelectionRegression?: number;
  readonly maxArgumentRegression?: number;
  readonly maxTimeoutRateIncrease?: number;
  readonly maxDurationRatio?: number | null;
  readonly maxTokenRatio?: number | null;
  readonly requireAtLeastBaselineTrials?: boolean;
  readonly requireSameCaseDefinitions?: boolean;
  readonly disallowNewEnvironmentErrors?: boolean;
}

export interface ChangeCheckIssue {
  readonly code: string;
  readonly severity: "error";
  readonly caseId?: string;
  readonly condition?: string;
  readonly message: string;
}

export interface ChangeCheckCell {
  readonly caseId: string;
  readonly condition: string;
  readonly status: "added" | "improved" | "missing" | "regressed" | "unchanged";
  readonly baseline: Readonly<Record<string, unknown>> | null;
  readonly candidate: Readonly<Record<string, unknown>> | null;
  readonly deltas: Readonly<Record<string, number | null>> | null;
  readonly issues: readonly ChangeCheckIssue[];
}

export interface ChangeCheck {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly suite: string;
  readonly status: "pass" | "fail";
  readonly grading: "authoritative application oracle";
  readonly baseline: Readonly<Record<string, unknown>>;
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly policy: Required<ChangeCheckPolicy>;
  readonly summary: {
    readonly matchedCells: number;
    readonly addedCells: number;
    readonly missingCells: number;
    readonly improvedCells: number;
    readonly regressions: number;
  };
  readonly regressions: readonly ChangeCheckIssue[];
  readonly cells: readonly ChangeCheckCell[];
}

export const CHANGE_CHECK_SCHEMA_VERSION: 1;
export class ChangeCheckRegressionError extends Error {
  readonly check: ChangeCheck;
}
export function buildChangeCheck(input: {
  readonly baseline: EvaluationReport;
  readonly candidate: EvaluationReport;
  readonly policy?: ChangeCheckPolicy;
}): ChangeCheck;
export function renderChangeCheckMarkdown(check: ChangeCheck): string;
export function writeChangeCheck(input: {
  readonly baseline: EvaluationReport;
  readonly candidate: EvaluationReport;
  readonly outputDir: string;
  readonly policy?: ChangeCheckPolicy;
}): {
  readonly check: ChangeCheck;
  readonly jsonPath: string;
  readonly markdownPath: string;
};
