/**
 * The arms under comparison. Every arm calls the same application operation
 * through the same fault injector, so the only variable is the execution layer.
 *
 * A0 (DOM or computer-use driving) and A2 (independently hand-rolled controls)
 * are declared here as pending, so the table shows what is not yet measured
 * rather than quietly omitting it.
 */
import { resolve, dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { faultedHandler } from "./faults.js";
import { OptimisticMemoryStore, SqliteConservativeStore } from "./stores.js";

/**
 * `run.js` sets SIGNET_DIST to the absolute entry point of the build its preflight
 * just verified. Resolving anything else here would let the benchmark build one
 * checkout and score another, which is the same silent staleness the preflight
 * exists to prevent. The fallback is only for running this module directly.
 */
const benchDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const SIGNET_DIST = resolve(
  process.env.SIGNET_DIST ?? join(benchDir, "..", "signet", "dist", "index.js"),
);

let guard;
try {
  ({ guard } = await import(pathToFileURL(SIGNET_DIST).href));
} catch (error) {
  throw new Error(
    `Could not load the Signet guard from "${SIGNET_DIST}".\n` +
      `Run the benchmark through ./run.js, which builds it first.\n` +
      `Underlying error: ${error.message}`,
  );
}

const stableKey = (actorId, toolName, input) =>
  `${actorId}:${toolName}:${JSON.stringify(input, Object.keys(input).sort())}`;

/** Reads authoritative state, not the handler's return value. */
const verifiers = {
  "book-tickets": ({ output, ctx }) => {
    const row = ctx.db.prepare("SELECT status FROM bookings WHERE id = ?").get(output.bookingId);
    return row?.status === "confirmed";
  },
  "cancel-booking": ({ output, ctx }) => {
    const row = ctx.db.prepare("SELECT status FROM bookings WHERE id = ?").get(output.bookingId);
    return row?.status === "cancelled";
  },
  "update-booking-notes": ({ input, ctx }) => {
    const row = ctx.db.prepare("SELECT notes FROM bookings WHERE id = ?").get(input.bookingId);
    return row?.notes === input.notes;
  },
};

export const ARMS = {
  A0_dom: { label: "A0 DOM driving", pending: true },
  A1_raw: { label: "A1 raw tools", build: buildRaw },
  A2_handrolled: { label: "A2 hand-rolled controls", pending: true },
  A3a_signet_memory: { label: "A3a Signet, shipped store", build: (a) => buildGuarded(a, "memory") },
  A3b_signet_durable: { label: "A3b Signet, harness store", build: (a) => buildGuarded(a, "durable") },
};

function buildRaw({ execute, faults, ctx }) {
  const handler = faultedHandler((input) => execute(input, ctx), faults);
  return (input, options) => handler(input, options);
}

function buildGuarded({ execute, faults, ctx, toolName }, storeKind) {
  const handler = faultedHandler((input) => execute(input, ctx), faults);
  const store =
    storeKind === "durable" ? new SqliteConservativeStore(ctx.db) : new OptimisticMemoryStore();
  const verify = verifiers[toolName];

  return guard(handler, {
    name: toolName,
    context: () => ({ actorId: ctx.actorId }),
    idempotency: {
      key: ({ input, context }) => stableKey(context.actorId, toolName, input),
      store,
    },
    ...(verify ? { verify: ({ input, output }) => verify({ input, output, ctx }) } : {}),
  });
}
