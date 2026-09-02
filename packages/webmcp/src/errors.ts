export type SignetErrorCode =
  | "authorization_denied"
  | "confirmation_declined"
  | "invalid_input"
  | "verification_failed"
  | "outcome_unknown"
  | (string & {});

export class SignetError extends Error {
  readonly code: SignetErrorCode;

  constructor(code: SignetErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SignetError";
    this.code = code;
  }
}

export interface ToolErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly repair?: ToolRepairGuidance;
  readonly details?: unknown;
  readonly cause?: unknown;
}

export type ToolRepairAction =
  | "ask_user"
  | "call_tool"
  | "change_input"
  | "reconcile"
  | "refresh_state"
  | "retry_same_operation"
  | "stop";

export type ToolRetryPolicy = "never" | "as_is" | "after_repair";

/** One explicit, application-authored action that is safe to show to an agent. */
export type ToolRepairStep =
  | {
      readonly action: "call_tool";
      readonly tool: string;
      readonly instruction: string;
    }
  | {
      readonly action: Exclude<ToolRepairAction, "call_tool">;
      readonly tool?: string;
      readonly instruction: string;
    };

/** Ordered recovery actions and the original input fields they must preserve. */
export interface ToolRepairPlan {
  readonly steps: readonly [ToolRepairStep, ...ToolRepairStep[]];
  readonly preserve?: readonly string[];
}

export type ToolRepairGuidance = ToolRepairStep | ToolRepairPlan;

export class ToolError extends SignetError {
  readonly retryable: boolean;
  readonly retry: ToolRetryPolicy;
  readonly repair?: ToolRepairGuidance;
  readonly details?: unknown;

  constructor(options: ToolErrorOptions) {
    const retryable = options.retryable ?? false;
    const retry: ToolRetryPolicy = !retryable
      ? "never"
      : options.repair
        ? "after_repair"
        : "as_is";
    super(
      options.code,
      `[${options.code}] ${options.message} ${retryMessage(retry)}${repairMessage(options.repair)}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ToolError";
    this.retryable = retryable;
    this.retry = retry;
    if (options.repair !== undefined) this.repair = options.repair;
    if (options.details !== undefined) this.details = options.details;
  }
}

function retryMessage(retry: ToolRetryPolicy): string {
  if (retry === "never") return "(retryable: no)";
  if (retry === "as_is") return "(retryable: yes)";
  return "(retryable: yes; only after repair)";
}

function repairMessage(repair: ToolRepairGuidance | undefined): string {
  if (!repair) return "";
  if ("steps" in repair) return repairPlanMessage(repair);
  return ` Next action: ${repairStepMessage(repair, 300)}`;
}

function repairPlanMessage(plan: ToolRepairPlan): string {
  const steps = plan.steps
    .slice(0, 5)
    .map((step, index) => `${index + 1}. ${repairStepMessage(step, 140)}`)
    .join(" ");
  const omitted = plan.steps.length - 5;
  const preserve = (plan.preserve ?? [])
    .map((field) => compact(field).slice(0, 64))
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
  const omittedSteps =
    omitted > 0 ? ` ${omitted} additional step(s) omitted.` : "";
  const invariants = preserve
    ? ` Keep these original inputs unchanged: ${preserve}.`
    : "";
  return ` Repair plan (run in order; do not parallelize): ${steps}${omittedSteps}${invariants}`;
}

function repairStepMessage(step: ToolRepairStep, limit: number): string {
  const instruction = compact(step.instruction);
  const boundedInstruction =
    instruction.length <= limit
      ? instruction
      : `${instruction.slice(0, limit - 1).trimEnd()}…`;
  const tool = step.tool ? compact(step.tool).slice(0, 128) : undefined;
  const target = tool ? ` ${tool}` : "";
  const sequencing =
    step.action === "call_tool" && tool
      ? ` Wait for ${tool} to finish before continuing.`
      : "";
  return `${step.action}${target}.${sequencing}${boundedInstruction ? ` ${boundedInstruction}` : ""}`;
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
}

export class ValidationError extends SignetError {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], options?: ErrorOptions) {
    super("invalid_input", validationMessage(issues), options);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

function validationMessage(issues: readonly ValidationIssue[]): string {
  const actionable = actionableIssues(issues);
  const visible = actionable.slice(0, 3);
  const detail = visible
    .map(({ path, message, keyword }) => {
      const location = path.replace(/^#/, "") || "/";
      const reason = keyword === "false" ? "is not allowed" : message;
      return `${location}: ${reason.replace(/\.+$/, "")}`;
    })
    .join("; ");
  const remaining = actionable.length - visible.length;
  const suffix =
    remaining > 0
      ? `; plus ${remaining} more issue${remaining === 1 ? "" : "s"}`
      : "";
  return `Invalid tool input — ${detail || "the input does not match the schema"}${suffix}.`.slice(
    0,
    300,
  );
}

function actionableIssues(
  issues: readonly ValidationIssue[],
): readonly ValidationIssue[] {
  const byPath = new Map<string, ValidationIssue>();
  for (const issue of issues) {
    if (["properties", "additionalProperties"].includes(issue.keyword)) {
      continue;
    }
    const current = byPath.get(issue.path);
    if (
      !current ||
      (current.keyword === "false" && issue.keyword !== "false")
    ) {
      byPath.set(issue.path, issue);
    }
  }
  return byPath.size > 0 ? [...byPath.values()] : issues;
}

export class AuthorizationError extends SignetError {
  constructor(
    reason = "The operation is not authorized.",
    options?: ErrorOptions,
  ) {
    super("authorization_denied", reason, options);
    this.name = "AuthorizationError";
  }
}

export class ConfirmationError extends SignetError {
  constructor(
    reason = "The user declined this operation.",
    options?: ErrorOptions,
  ) {
    super("confirmation_declined", reason, options);
    this.name = "ConfirmationError";
  }
}

export class VerificationError extends SignetError {
  constructor(
    reason = "The operation's result could not be verified.",
    options?: ErrorOptions,
  ) {
    super("verification_failed", reason, options);
    this.name = "VerificationError";
  }
}

/** The effect may exist, but authoritative recovery could not prove either state. */
export class OutcomeUnknownError extends SignetError {
  readonly retryable = false;

  constructor(
    reason = "The operation may have completed, but its outcome could not be determined.",
    options?: ErrorOptions,
  ) {
    super(
      "outcome_unknown",
      `[outcome_unknown] ${reason} Do not retry with a new operation key.`,
      options,
    );
    this.name = "OutcomeUnknownError";
  }
}
