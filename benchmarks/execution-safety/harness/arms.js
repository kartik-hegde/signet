/**
 * The arms under comparison. Every arm calls the same application operation
 * through the same fault injector, so the only variable is the execution layer.
 *
 * A0 remains pending. A2 is one benchmark-authored hand-rolled adapter; independent
 * implementer cohorts remain future work in the build-versus-buy lane.
 */
import { resolve, dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { faultedHandler } from "./faults.js";
import {
  SqliteConservativeStore,
  SqliteOperationJournal,
  SqlitePhasedStore,
} from "./stores.js";
import { buildHandrolled } from "./adapters/handrolled.js";
import { buildWithSignett } from "./adapters/signett.js";

/**
 * `run.js` sets SIGNETT_DIST to the absolute entry point of the build its preflight
 * just verified. Resolving anything else here would let the benchmark build one
 * checkout and score another, which is the same silent staleness the preflight
 * exists to prevent. The fallback is only for running this module directly.
 */
const benchDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const SIGNETT_DIST = resolve(
  process.env.SIGNETT_DIST ?? join(benchDir, "..", "signett", "dist", "index.js"),
);

let guard;
let MemoryIdempotencyStore;
try {
  ({ guard } = await import(pathToFileURL(SIGNETT_DIST).href));
  ({ MemoryIdempotencyStore } = await import(
    pathToFileURL(resolve(dirname(SIGNETT_DIST), "testing.js")).href
  ));
} catch (error) {
  throw new Error(
    `Could not load the Signett guard from "${SIGNETT_DIST}".\n` +
      `Run the benchmark through ./run.js, which builds it first.\n` +
      `Underlying error: ${error.message}`,
  );
}

const stableKey = (actorId, toolName, input) =>
  `${actorId}:${toolName}:${JSON.stringify(input, Object.keys(input).sort())}`;

/** Reads authoritative state, not the handler's return value. */
const verifiers = {
  "book-tickets": ({ output, ctx }) => {
    const row = ctx.db
      .prepare("SELECT status FROM bookings WHERE id = ?")
      .get(output.bookingId);
    return row?.status === "confirmed";
  },
  "cancel-booking": ({ output, ctx }) => {
    const row = ctx.db
      .prepare("SELECT status FROM bookings WHERE id = ?")
      .get(output.bookingId);
    return row?.status === "cancelled";
  },
  "update-booking-notes": ({ input, ctx }) => {
    const row = ctx.db
      .prepare("SELECT notes FROM bookings WHERE id = ?")
      .get(input.bookingId);
    return row?.notes === input.notes;
  },
};

export const ARMS = {
  A0_dom: { label: "A0 DOM driving", pending: true },
  A1_raw: { label: "A1 raw tools", build: buildRaw },
  A2_handrolled: {
    label: "A2 hand-rolled controls",
    build: buildHandrolledArm,
  },
  A3a_signett_memory: {
    label: "A3a Signett, test-only memory",
    build: (a) => buildGuarded(a, "memory"),
  },
  A3b_signett_durable: {
    label: "A3b Signett, phased durable",
    build: (a) => buildGuarded(a, "durable"),
  },
};

function buildRaw({ execute, faults, ctx, validate }) {
  const handler = faultedHandler(
    (input, options) => execute(input, { ...ctx, operation: options?.operation }),
    faults,
  );
  return (input, options) => {
    validate(input);
    return handler(input, options);
  };
}

function buildHandrolledArm({ execute, faults, ctx, toolName, validate }) {
  const handler = faultedHandler((input) => execute(input, ctx), faults);
  const store = new SqliteConservativeStore(ctx.db);
  const verify = verifiers[toolName];
  return buildHandrolled({
    handler,
    store,
    key: (input) => stableKey(ctx.actorId, toolName, input),
    validate,
    verify: verify
      ? ({ input, output }) => verify({ input, output, ctx })
      : undefined,
  });
}

function buildGuarded({ execute, faults, ctx, toolName, validate }, storeKind) {
  const handler = faultedHandler(
    (input, options) => execute(input, { ...ctx, operation: options?.operation }),
    faults,
  );
  const store =
    storeKind === "durable"
      ? new SqlitePhasedStore(ctx.db)
      : new MemoryIdempotencyStore();
  const verify = verifiers[toolName];
  const journal = new SqliteOperationJournal(ctx.db);

  const recover =
    toolName === "book-tickets"
      ? async ({ operation }) => {
          if (ctx.recoveryUnavailable) {
            throw new Error("authoritative recovery is temporarily unavailable");
          }
          const correlation = await operation?.read();
          if (!correlation?.bookingId) return { recovered: false };
          const booking = ctx.db
            .prepare("SELECT id, quantity, status FROM bookings WHERE id = ?")
            .get(correlation.bookingId);
          return booking
            ? {
                recovered: true,
                output: {
                  bookingId: booking.id,
                  quantity: booking.quantity,
                  status: booking.status,
                },
              }
            : { recovered: false, outcome: "unknown" };
        }
      : undefined;

  return buildWithSignett({
    handler,
    store,
    journal,
    key: (input) => stableKey(ctx.actorId, toolName, input),
    validate,
    recover,
    verify: verify
      ? ({ input, output }) => verify({ input, output, ctx })
      : undefined,
    guard,
  });
}
