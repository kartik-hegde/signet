export type SignetErrorCode =
  | "authorization_denied"
  | "confirmation_declined"
  | "invalid_input"
  | "verification_failed"
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
  readonly details?: unknown;
  readonly cause?: unknown;
}

export class ToolError extends SignetError {
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(options: ToolErrorOptions) {
    const retryable = options.retryable ?? false;
    super(
      options.code,
      `[${options.code}] ${options.message} (retryable: ${retryable ? "yes" : "no"})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ToolError";
    this.retryable = retryable;
    if (options.details !== undefined) this.details = options.details;
  }
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
