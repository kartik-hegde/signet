import { spawnSync } from "node:child_process";
import { docker, platform } from "./paths.mjs";

const emailIndex = process.argv.indexOf("--email");
const email = emailIndex >= 0 ? process.argv[emailIndex + 1] : "proof@example.com";
if (!email || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+$/i.test(email)) {
  throw new Error("Pass a valid test address with --email.");
}

const escapedEmail = email.replaceAll("'", "''");
const sql = `SELECT number, status, user_email, total_gross_amount, currency, charge_status
FROM order_order
WHERE user_email = '${escapedEmail}'
ORDER BY created_at DESC;`;

const result = spawnSync(
  docker,
  ["compose", "exec", "-T", "db", "psql", "-U", "saleor", "-d", "saleor", "-At", "-F", "\t", "-c", sql],
  { cwd: platform, encoding: "utf8" },
);
if (result.status !== 0) throw new Error(result.stderr.trim() || "Saleor oracle query failed");

const orders = result.stdout
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [number, status, userEmail, totalAmount, currency, chargeStatus] = line.split("\t");
    return { number, status, userEmail, totalAmount: Number(totalAmount), currency, chargeStatus };
  });

console.log(JSON.stringify({ email, orderCount: orders.length, orders }, null, 2));
