class VerificationError extends Error {
  constructor() {
    super("The authoritative result could not be verified.");
    this.name = "VerificationError";
    this.code = "verification_failed";
  }
}

/** Minimal independently implemented controls for the build-versus-buy baseline. */
export function buildHandrolled({ handler, store, key, verify }) {
  return async (input, options) => {
    options.signal.throwIfAborted();
    const result = await store.execute(
      key(input),
      () => handler(input, options),
      options,
    );
    if (
      verify &&
      !(await verify({
        input,
        output: result.value,
        replayed: result.replayed,
      }))
    ) {
      throw new VerificationError();
    }
    return result.value;
  };
}
