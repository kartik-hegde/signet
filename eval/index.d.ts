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
