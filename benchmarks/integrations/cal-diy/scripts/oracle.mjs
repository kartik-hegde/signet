import { spawnSync } from "node:child_process";
import { databaseCompose } from "./paths.mjs";

const emailIndex = process.argv.indexOf("--email");
const email = emailIndex >= 0 ? process.argv[emailIndex + 1] : "signet-case-study@example.test";
if (!email || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+$/i.test(email)) {
  throw new Error("Pass a valid benchmark address with --email.");
}

const escapedEmail = email.replaceAll("'", "''");
const sql = `SELECT b.uid, b.status, b."eventTypeId", b.title,
  b."startTime" AT TIME ZONE 'UTC', b."endTime" AT TIME ZONE 'UTC', a.email,
  EXTRACT(EPOCH FROM (b."endTime" - b."startTime")) / 60
FROM "Booking" b
JOIN "Attendee" a ON a."bookingId" = b.id
WHERE lower(a.email) = lower('${escapedEmail}')
ORDER BY b."createdAt" DESC;`;

const result = spawnSync(
  "docker",
  ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "cal-saml", "-At", "-F", "\t", "-c", sql],
  { cwd: databaseCompose, encoding: "utf8" }
);
if (result.status !== 0) throw new Error(result.stderr.trim() || "Cal.diy oracle query failed.");

const bookings = result.stdout
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [uid, status, eventTypeId, title, startTime, endTime, attendeeEmail, durationMinutes] =
      line.split("\t");
    return {
      uid,
      status,
      eventTypeId: Number(eventTypeId),
      title,
      startTime,
      endTime,
      attendeeEmail,
      durationMinutes: Number(durationMinutes),
    };
  });

console.log(JSON.stringify({ email, bookingCount: bookings.length, bookings }, null, 2));
