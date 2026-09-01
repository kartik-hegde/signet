/**
 * Authoritative state, read directly from the database after the caller stops.
 * Nothing here is reachable from the agent, the tools, or the page.
 */
import { openReadOnly } from "../app/db.js";

export function oracle(path) {
  const db = openReadOnly(path);
  return {
    bookings(filter = {}) {
      const clauses = [];
      const values = [];
      for (const [column, value] of Object.entries(filter)) {
        clauses.push(`${column} = ?`);
        values.push(value);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return db.prepare(`SELECT * FROM bookings ${where} ORDER BY id`).all(...values);
    },
    event(id) {
      return db.prepare("SELECT * FROM events WHERE id = ?").get(id);
    },
    close() { db.close(); },
  };
}
