export type SignetErrorCode = "authorization_denied" | "verification_failed";

export class SignetError extends Error {
  readonly code: SignetErrorCode;

  constructor(code: SignetErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SignetError";
    this.code = code;
  }
}

export class AuthorizationError extends SignetError {
  constructor(reason = "The operation is not authorized.", options?: ErrorOptions) {
    super("authorization_denied", reason, options);
    this.name = "AuthorizationError";
  }
}

export class VerificationError extends SignetError {
  constructor(reason = "The operation's result could not be verified.", options?: ErrorOptions) {
    super("verification_failed", reason, options);
    this.name = "VerificationError";
  }
}
