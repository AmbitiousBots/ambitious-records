import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export const repoRoot = join(import.meta.dirname, "..");
export const binary = join(repoRoot, "dist", "ambitious-records.mjs");
export const now = "2026-01-01T00:00:00.000Z";

export const makeHome = () => {
  mkdirSync(join(repoRoot, ".scratch"), { recursive: true });
  return mkdtempSync(join(repoRoot, ".scratch", "records-test-"));
};

export const freshHome = (t) => {
  const home = makeHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
};

export const call = (home, command, input, options = {}) => {
  const args = Array.isArray(command) ? command : command.split(" ");
  const result = spawnSync(process.execPath, [...(options.runtimeArgs ?? []), options.binary ?? binary, ...args, "--now", options.now ?? now, "--seed", "7", ...(options.args ?? [])], {
    encoding: "utf8",
    cwd: options.cwd ?? repoRoot,
    input: input === undefined ? "" : JSON.stringify(input),
    env: { ...process.env, AMBITIOUS_HOME: home },
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  let envelope;
  assert.doesNotThrow(() => { envelope = JSON.parse(result.stdout); }, `one JSON envelope required: ${result.stdout}\n${result.stderr}`);
  assert.deepEqual(Object.keys(envelope).sort(), ["command", "data", "errors", "meta", "module", "ok", "schemaVersion"]);
  assert.equal(envelope.module, "records");
  assert.equal(envelope.command, args.join(" "));
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.meta.version, "0.1.2");
  assert.equal(envelope.meta.seed, 7);
  assert.equal(envelope.meta.now, options.now ?? now);
  return { ...envelope, exit: result.status, stdout: result.stdout, stderr: result.stderr };
};

export const success = (home, command, input, options) => {
  const answer = call(home, command, input, options);
  assert.equal(answer.exit, 0, answer.stdout);
  assert.equal(answer.ok, true, answer.stdout);
  assert.deepEqual(answer.errors, []);
  return answer.data;
};

export const refused = (home, command, input, code) => {
  const answer = call(home, command, input);
  assert.equal(answer.exit, 1, answer.stdout);
  assert.equal(answer.ok, false);
  assert.equal(answer.errors[0].code, code, answer.stdout);
  assert.ok(answer.errors[0].message.length > 0);
  assert.ok(answer.errors[0].hint.length > 0);
  return answer.data;
};

export const preset = (name) => JSON.parse(readFileSync(join(repoRoot, "presets", `${name}.json`), "utf8"));
export const define = (home, definition = preset("invoice")) => success(home, "type define", definition);
export const create = (home, fields, key = "create-one", type = "invoice") => success(home, "create", { type, fields, idem_key: key }).record;
export const history = (home, id) => success(home, "history", { id }).events;
export const records = (home, query = { type: "invoice" }) => success(home, "query", query).records;
