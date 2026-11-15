import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const pinned = JSON.parse(execFileSync("mise", ["env", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const env = { ...process.env, ...pinned };
const steps = ["typecheck", "lint", "depcruise", "check:schemas", "test", "contract", "tlc", "verify", "release:build"];
const results = [];
for (const step of steps) {
  process.stdout.write(`\n=== npm run ${step}\n`);
  const result = spawnSync("npm", ["run", "--silent", step], { cwd: root, stdio: "inherit", env });
  results.push({ step, passed: result.status === 0 });
}
process.stdout.write("\nStep             Result\n---------------  ------\n");
for (const { step, passed } of results) process.stdout.write(`${step.padEnd(15)}  ${passed ? "pass" : "FAIL"}\n`);
const passed = results.filter((result) => result.passed).length;
process.stdout.write(`\nrelease check: ${passed === steps.length ? "ok" : "FAILED"}. ${passed} of ${steps.length} steps passed.\n`);
process.exitCode = passed === steps.length ? 0 : 1;
