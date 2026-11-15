import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, "spec", path), "utf8");
const expected = JSON.parse(read("broken/EXPECTED.json"));
const configuration = read("StageMachine.cfg");
const invariants = configuration.split(/^INVARIANTS?\s*$/m)[1]?.trim().split(/\s+/) ?? [];
assert(invariants.length > 1, "Declare every stage-machine invariant in StageMachine.cfg.");
for (const invariant of invariants.filter((name) => name !== "TypeOK")) {
  assert(Object.values(expected).some((entry) => entry.invariant === invariant), `Add a broken variant for ${invariant}.`);
}

const changedLines = (left, right) => {
  const previous = new Array(right.length + 1).fill(0);
  for (const line of left) {
    let diagonal = 0;
    for (let column = 1; column <= right.length; column += 1) {
      const saved = previous[column];
      previous[column] = line === right[column - 1] ? diagonal + 1 : Math.max(previous[column], previous[column - 1]);
      diagonal = saved;
    }
  }
  return left.length + right.length - 2 * previous[right.length];
};

for (const name of Object.keys(expected)) {
  assert.match(name, /^[A-Za-z0-9_]+$/);
  assert.equal(read(`broken/${name}.cfg`), configuration, `${name} must use the same configuration as StageMachine.`);
  const original = read("StageMachine.tla").replace("MODULE StageMachine", `MODULE ${name}`).split("\n");
  const changed = changedLines(original, read(`broken/${name}.tla`).split("\n"));
  assert(changed >= 1 && changed <= 2, `${name} must change only one guard, not ${changed} lines.`);
}
process.stdout.write("Model drift: every invariant has a broken variant with the same configuration and one changed guard.\n");
const result = spawnSync(process.execPath, ["scripts/tlc.mjs"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
assert.equal(result.status, 0, "Fix the failing model; keep the invariant expectations.");
const counts = [...result.stdout.matchAll(/found no error in (\d+) states/g)].map((match) => Number(match[1]));
assert(counts.length > 0 && counts.every((count) => count > 1000), "The passing model must explore more than 1000 distinct states.");
process.stdout.write("Model coverage: every passing model explores more than 1000 distinct states.\n");
