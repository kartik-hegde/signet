export type SignetErrorCode =
  | "authorization_denied"
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
    super(
      options.code,
      options.message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ToolError";
    this.retryable = options.retryable ?? false;
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
    super("invalid_input", "The tool input is invalid.", options);
    this.name = "ValidationError";
    this.issues = issues;
  }
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

export class VerificationError extends SignetError {
  constructor(
    reason = "The operation's result could not be verified.",
    options?: ErrorOptions,
  ) {
    super("verification_failed", reason, options);
    this.name = "VerificationError";
  }
}
