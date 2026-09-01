const failures = [];

if (process.env.CHANGES_RESULT !== "success")
  failures.push(`changes=${process.env.CHANGES_RESULT}`);
for (const lane of [
  "SDK",
  "COMPATIBILITY",
  "EVAL",
  "SAFETY",
  "REFERENCE",
  "EVIDENCE",
  "DOCS",
  "INTEGRATIONS",
]) {
  if (
    process.env[`${lane}_NEEDED`] === "true" &&
    process.env[`${lane}_RESULT`] !== "success"
  ) {
    failures.push(`${lane.toLowerCase()}=${process.env[`${lane}_RESULT`]}`);
  }
}

if (failures.length)
  throw new Error(`Required CI lanes did not succeed: ${failures.join(", ")}`);
process.stdout.write("Every selected CI lane succeeded.\n");
