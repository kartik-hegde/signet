/**
 * The application's own service layer.
 *
 * Written the way a competent team writes it: transactional, with conditional
 * updates. The benchmark deliberately does NOT sabotage this layer. Every failure
 * the suite measures happens at the invocation boundary above it, which is the
 * layer an execution guard occupies.
 *
 * `ctx.hooks.pause(label)` is a scheduling seam. It exists so concurrent
 * interleavings are deterministic and therefore reproducible. It is a no-op
 * unless a scenario installs a schedule.
 */

export class NotFoundError extends Error {
  constructor(what) { super(`${what} not found`); this.name = "NotFoundError"; }
}
export class SoldOutError extends Error {
  constructor() { super("not enough capacity remaining"); this.name = "SoldOutError"; }
}
export class NotOwnerError extends Error {
  constructor() { super("the actor does not own this booking"); this.name = "NotOwnerError"; }
}

export const operations = {
  /** Read. Present so the tool surface is not exclusively mutations. */
  async listEvents(_input, ctx) {
    return ctx.db.prepare("SELECT id, name, remaining FROM events ORDER BY id").all();
  },

  /**
   * Mutation. Two invocations with the same intent produce two legitimate
   * bookings. No amount of backend correctness prevents that, because each
   * call is individually valid. Duplicate suppression has to live above.
   */
  async bookTickets(input, ctx) {
    const quantity = Number(input.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new TypeError("quantity must be a positive integer");
    }
    const bookingId = ctx.ids.next("b");

    await ctx.hooks.pause("bookTickets:beforeWrite");

    ctx.db.exec("BEGIN IMMEDIATE");
    try {
      const changed = ctx.db
        .prepare("UPDATE events SET remaining = remaining - ? WHERE id = ? AND remaining >= ?")
        .run(quantity, input.eventId, quantity);
      if (changed.changes === 0) {
        const exists = ctx.db.prepare("SELECT 1 FROM events WHERE id = ?").get(input.eventId);
        throw exists ? new SoldOutError() : new NotFoundError("event");
      }
      ctx.db
        .prepare(
          "INSERT INTO bookings (id, user_id, event_id, quantity, notes, status, created_at) VALUES (?, ?, ?, ?, '', 'confirmed', ?)",
        )
        .run(bookingId, ctx.actorId, input.eventId, quantity, ctx.clock.now());
      ctx.db.exec("COMMIT");
    } catch (error) {
      ctx.db.exec("ROLLBACK");
      throw error;
    }

    return { bookingId, status: "confirmed", quantity };
  },

  /**
   * Mutation that is already idempotent at the data layer, because the status
   * transition is conditional. Included as a control: a suite that rewards a
   * guard on every operation is not measuring anything.
   */
  async cancelBooking(input, ctx) {
    const booking = ctx.db
      .prepare("SELECT id, user_id, event_id, quantity, status FROM bookings WHERE id = ?")
      .get(input.bookingId);
    if (!booking) throw new NotFoundError("booking");
    if (booking.user_id !== ctx.actorId) throw new NotOwnerError();

    await ctx.hooks.pause("cancelBooking:beforeWrite");

    ctx.db.exec("BEGIN IMMEDIATE");
    try {
      const changed = ctx.db
        .prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'")
        .run(input.bookingId);
      if (changed.changes === 1) {
        ctx.db
          .prepare("UPDATE events SET remaining = remaining + ? WHERE id = ?")
          .run(booking.quantity, booking.event_id);
      }
      ctx.db.exec("COMMIT");
    } catch (error) {
      ctx.db.exec("ROLLBACK");
      throw error;
    }

    return { bookingId: input.bookingId, status: "cancelled" };
  },

  /**
   * Mutation with read-modify-write semantics and no version token in the
   * signature, so concurrent callers silently overwrite each other. Neither the
   * raw arm nor the current guard prevents it. It is in the suite as an open
   * front to hill climb on.
   */
  async updateBookingNotes(input, ctx) {
    const booking = ctx.db
      .prepare("SELECT id, user_id, notes FROM bookings WHERE id = ?")
      .get(input.bookingId);
    if (!booking) throw new NotFoundError("booking");
    if (booking.user_id !== ctx.actorId) throw new NotOwnerError();

    await ctx.hooks.pause("updateBookingNotes:afterRead");

    ctx.db.prepare("UPDATE bookings SET notes = ? WHERE id = ?").run(input.notes, input.bookingId);
    return { bookingId: input.bookingId, notes: input.notes };
  },
};
