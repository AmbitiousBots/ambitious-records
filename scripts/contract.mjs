import assert from "node:assert/strict";
import { runContract } from "./contract-checks.mjs";

const fixtures = new Map([
  ["type get", { type: "entry" }],
  ["query", { type: "entry" }],
  ["allowed", { id: "missing-record" }],
  ["history", { id: "missing-record" }],
]);
const results = runContract("dist/ambitious-records.mjs", (name) => {
  assert(fixtures.has(name), `Add valid read-only contract input for ${name}.`);
  return fixtures.get(name);
});
for (const { id, title, problems } of results) {
  process.stdout.write(`${problems.length === 0 ? "ok  " : "FAIL"}  ${id.padEnd(19)} ${title}\n`);
  for (const problem of problems) process.stdout.write(`      ${problem}\n`);
}
const passed = results.filter(({ problems }) => problems.length === 0).length;
process.stdout.write(`contract: ${passed === results.length ? "ok" : "FAILED"}. ${passed} of ${results.length} checks passed for dist/ambitious-records.mjs.\n`);
process.exitCode = passed === results.length ? 0 : 1;
