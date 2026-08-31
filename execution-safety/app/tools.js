/**
 * The agent-facing tool surface.
 *
 * Derivation rule, fixed before any scenario was written: one tool per public
 * operation in `app/operations.js`, with the operation's own parameters and
 * nothing added. No tool is shaped around a scenario, and no tool combines
 * operations to shorten a task. Anyone auditing this benchmark should be able
 * to check the rule by diffing the two files.
 */
import { operations } from "./operations.js";

export const toolSurface = [
  {
    name: "list-events",
    description: "Lists events with remaining capacity.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    operation: "listEvents",
    mutates: false,
  },
  {
    name: "book-tickets",
    description: "Books a quantity of tickets for one event, for the signed-in user.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string" }, quantity: { type: "integer", minimum: 1 } },
      required: ["eventId", "quantity"],
      additionalProperties: false,
    },
    operation: "bookTickets",
    mutates: true,
  },
  {
    name: "cancel-booking",
    description: "Cancels one booking owned by the signed-in user.",
    inputSchema: {
      type: "object",
      properties: { bookingId: { type: "string" } },
      required: ["bookingId"],
      additionalProperties: false,
    },
    operation: "cancelBooking",
    mutates: true,
  },
  {
    name: "update-booking-notes",
    description: "Replaces the notes on one booking owned by the signed-in user.",
    inputSchema: {
      type: "object",
      properties: { bookingId: { type: "string" }, notes: { type: "string" } },
      required: ["bookingId", "notes"],
      additionalProperties: false,
    },
    operation: "updateBookingNotes",
    mutates: true,
  },
];

export const handlerFor = (toolName) => {
  const tool = toolSurface.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`unknown tool: ${toolName}`);
  return { tool, execute: operations[tool.operation] };
};
