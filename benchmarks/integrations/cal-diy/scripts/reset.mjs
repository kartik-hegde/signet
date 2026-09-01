import { spawnSync } from "node:child_process";
import { databaseCompose } from "./paths.mjs";

const emailIndex = process.argv.indexOf("--email");
const email = emailIndex >= 0 ? process.argv[emailIndex + 1] : "signet-case-study@example.test";
if (!email || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+$/i.test(email)) {
  throw new Error("Pass a valid benchmark address with --email.");
}

const escapedEmail = email.replaceAll("'", "''");
const sql = `DELETE FROM "Booking" b
USING "Attendee" a
WHERE a."bookingId" = b.id AND lower(a.email) = lower('${escapedEmail}');`;
const result = spawnSync(
  "docker",
  ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "cal-saml", "-At", "-c", sql],
  { cwd: databaseCompose, encoding: "utf8" }
);
if (result.status !== 0) throw new Error(result.stderr.trim() || "Cal.diy reset failed.");
console.log(JSON.stringify({ email, reset: true, databaseResult: result.stdout.trim() }, null, 2));
