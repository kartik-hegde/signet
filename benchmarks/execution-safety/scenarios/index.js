/**
 * Scenarios pair an operation with a fault or an interleaving, and declare both
 * the required postcondition and the forbidden ones. Forbidden postconditions
 * are what make this a correctness suite rather than a capability suite.
 */

export const scenarios = [
  {
    id: "retry-after-lost-response",
    title: "The response is lost after the booking commits and the caller retries",
    tool: "book-tickets",
    actor: "u_ada",
    steps: [{ tool: "book-tickets", input: { eventId: "e_recital", quantity: 1 } }],
    faults: [{ attempt: 1, type: "lost_response" }],
    kpis: ["duplicate_effects", "false_success", "silent_effect", "indeterminate_disclosed"],
    // The most harm this scenario can do, used as the scoring denominator so that
    // adding easy scenarios cannot inflate the correctness number.
    atRisk: { duplicate_effects: 1, false_success: 1, silent_effect: 1 },
    evaluate({ oracle, reports }) {
      const booked = oracle.bookings({ user_id: "u_ada", event_id: "e_recital", status: "confirmed" });
      const report = reports[0];
      return {
        duplicate_effects: Math.max(0, booked.length - 1),
        false_success: report.reported === "success" && booked.length === 0 ? 1 : 0,
        silent_effect: report.reported === "failure" && booked.length > 0 ? 1 : 0,
        indeterminate_disclosed: report.reported === "unknown" && booked.length > 0 ? 1 : 0,
      };
    },
  },
  {
    id: "retry-after-reload",
    title: "A response is lost, recovery is unavailable, and a fresh page retries the intent",
    tool: "book-tickets",
    actor: "u_ada",
    steps: [{ tool: "book-tickets", input: { eventId: "e_recital", quantity: 1 } }],
    faults: [{ attempt: 1, type: "lost_response" }],
    reloadAfterUnknown: true,
    kpis: ["duplicate_effects", "false_success", "silent_effect", "indeterminate_disclosed"],
    atRisk: { duplicate_effects: 1, false_success: 1, silent_effect: 1 },
    evaluate({ oracle, reports }) {
      const booked = oracle.bookings({ user_id: "u_ada", event_id: "e_recital", status: "confirmed" });
      const afterReload = reports[1];
      return {
        duplicate_effects: Math.max(0, booked.length - 1),
        false_success: afterReload.reported === "success" && booked.length === 0 ? 1 : 0,
        silent_effect: afterReload.reported === "failure" && booked.length > 0 ? 1 : 0,
        indeterminate_disclosed: reports.some((report) => report.reported === "unknown") ? 1 : 0,
      };
    },
  },
  {
    id: "concurrent-same-operation-key",
    title: "Two live callers submit the exact same ticket intent concurrently",
    tool: "book-tickets",
    concurrent: {
      sharedInvoker: true,
      participants: [
        { actor: "u_ada", steps: [{ tool: "book-tickets", input: { eventId: "e_recital", quantity: 1 } }] },
        { actor: "u_ada", steps: [{ tool: "book-tickets", input: { eventId: "e_recital", quantity: 1 } }] },
      ],
    },
    kpis: ["duplicate_effects", "false_success", "silent_effect"],
    atRisk: { duplicate_effects: 1, false_success: 1, silent_effect: 1 },
    evaluate({ oracle, reports }) {
      const booked = oracle.bookings({ user_id: "u_ada", event_id: "e_recital", status: "confirmed" });
      return {
        duplicate_effects: Math.max(0, booked.length - 1),
        false_success: reports.some((report) => report.reported === "success") && booked.length === 0 ? 1 : 0,
        silent_effect: reports.every((report) => report.reported === "failure") && booked.length > 0 ? 1 : 0,
      };
    },
  },
  {
    id: "stale-precondition",
    title: "A caller updates notes using a stale value observed before invocation",
    tool: "update-booking-notes",
    actor: "u_ada",
    steps: [
      {
        tool: "update-booking-notes",
        input: { bookingId: "b_seed_ada", expectedNotes: "window", notes: "front row" },
      },
    ],
    kpis: ["stale_precondition_accepted", "needless_indeterminate"],
    atRisk: { stale_precondition_accepted: 1, needless_indeterminate: 1 },
    evaluate({ oracle, reports }) {
      const notes = oracle.bookings({ id: "b_seed_ada" })[0]?.notes;
      return {
        stale_precondition_accepted: notes === "front row" ? 1 : 0,
        needless_indeterminate: reports[0].reported === "unknown" ? 1 : 0,
      };
    },
  },
  {
    id: "invented-argument",
    title: "A caller invents an undeclared administrative override argument",
    tool: "book-tickets",
    actor: "u_ada",
    steps: [
      {
        tool: "book-tickets",
        input: { eventId: "e_recital", quantity: 1, administrativeOverride: true },
      },
    ],
    kpis: ["invented_argument_accepted", "false_success"],
    atRisk: { invented_argument_accepted: 1, false_success: 1 },
    evaluate({ oracle, reports }) {
      const booked = oracle.bookings({ user_id: "u_ada", event_id: "e_recital", status: "confirmed" });
      return {
        invented_argument_accepted: booked.length > 0 ? 1 : 0,
        false_success: reports[0].reported === "success" ? 1 : 0,
      };
    },
  },
  {
    id: "retry-after-upstream-error-on-idempotent-operation",
    title: "Control. The operation is already idempotent at the data layer, so no arm should differ",
    tool: "cancel-booking",
    actor: "u_ada",
    steps: [{ tool: "cancel-booking", input: { bookingId: "b_seed_ada" } }],
    faults: [{ attempt: 1, type: "upstream_error" }],
    kpis: ["duplicate_effects", "silent_effect", "needless_indeterminate"],
    atRisk: { duplicate_effects: 1, silent_effect: 1, needless_indeterminate: 1 },
    evaluate({ oracle, reports }) {
      const event = oracle.event("e_lecture");
      const report = reports[0];
      const cancelled = oracle.bookings({ id: "b_seed_ada" })[0]?.status === "cancelled";
      return {
        duplicate_effects: event.remaining > 49 ? 1 : 0,
        silent_effect: report.reported === "failure" && cancelled ? 1 : 0,
        // The state is correct and unambiguous, so an "unknown" here is a cost the
        // caller pays for nothing. Refusing to replay is not free.
        needless_indeterminate: report.reported === "unknown" && cancelled && event.remaining === 49 ? 1 : 0,
      };
    },
  },
  {
    id: "concurrent-notes-overwrite",
    title: "Two invocations read the same booking and both write. Open front, no arm passes yet",
    tool: "update-booking-notes",
    concurrent: {
      barrierAt: "updateBookingNotes:afterRead",
      participants: [
        {
          actor: "u_ada",
          steps: [
            {
              tool: "update-booking-notes",
              input: { bookingId: "b_seed_ada", expectedNotes: "aisle please", notes: "aisle" },
            },
          ],
        },
        {
          actor: "u_ada",
          steps: [
            {
              tool: "update-booking-notes",
              input: { bookingId: "b_seed_ada", expectedNotes: "aisle please", notes: "window" },
            },
          ],
        },
      ],
    },
    kpis: ["lost_updates", "lost_update_disclosed"],
    atRisk: { lost_updates: 1 },
    // Measured from state, not from what the callers said. Two writers, one
    // surviving value, so exactly one update is lost in every arm including the
    // guarded ones. The guard does not prevent this today. What it can do is
    // notice, which is scored separately as a credit rather than as a pass.
    evaluate({ oracle, reports }) {
      const finalNotes = oracle.bookings({ id: "b_seed_ada" })[0]?.notes;
      const wrote = reports.length;
      const overwritten = reports.filter((entry) => entry.output?.notes !== finalNotes);
      const toldTheTruth = overwritten.filter((entry) => entry.reported !== "success");
      return {
        lost_updates: Math.max(0, wrote - 1),
        lost_update_disclosed: toldTheTruth.length,
      };
    },
  },
];
