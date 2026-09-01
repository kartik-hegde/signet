/**
 * Deterministic fault injection.
 *
 * A fault runs the application operation to completion, lets it commit, and only
 * then destroys the response. That is the shape that matters: the effect happened
 * and the caller cannot know it. A fault that prevents the write is uninteresting,
 * because every layer already handles it correctly.
 *
 * Faults are keyed by attempt number so a run is reproducible without a seed.
 */
export class LostResponseError extends Error {
  constructor() { super("connection reset before the response arrived"); this.name = "LostResponseError"; }
}
export class UpstreamError extends Error {
  constructor() { super("502 from the upstream service"); this.name = "UpstreamError"; }
}

export function faultedHandler(execute, schedule = []) {
  let attempt = 0;
  return async (input, options) => {
    attempt += 1;
    const output = await execute(input, options);
    const fault = schedule.find((entry) => entry.attempt === attempt);
    if (!fault) return output;
    if (fault.type === "lost_response") throw new LostResponseError();
    if (fault.type === "upstream_error") throw new UpstreamError();
    throw new Error(`unknown fault type: ${fault.type}`);
  };
}
