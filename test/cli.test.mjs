import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { binary, call, create, define, freshHome, history, now, preset, records, refused, repoRoot, success } from "./helpers.mjs";

const simple = () => ({
  type: "entry", version: 1,
  fields: { label: { kind: "string", required: true, unique: true }, note: { kind: "text" }, score: { kind: "int" }, ready: { kind: "bool" } },
  stages: ["draft", "ready", "done"], initial: "draft", terminal: ["done"],
  transitions: [{ from: "draft", to: "ready", requires: ["score", "ready"] }, { from: "ready", to: "done" }],
});

const snapshot = (directory) => Object.fromEntries(readdirSync(directory, { withFileTypes: true, recursive: true }).filter((entry) => entry.isFile() && !entry.name.endsWith("-shm")).flatMap((entry) => {
  const path = join(entry.parentPath, entry.name);
  const bytes = readFileSync(path);
  return entry.name.endsWith("-wal") && bytes.length === 0 ? [] : [[path.slice(directory.length), createHash("sha256").update(bytes).digest("hex")]];
}));

test("selfcheck: a fresh database migrates once and repeated checks preserve stored records", (t) => {
  const home = freshHome(t);
  const first = success(home, "selfcheck");
  assert.deepEqual(first.problems, []);
  assert.deepEqual(first.runtime, { name: "node", version: process.versions.node });
  assert.equal(first.binary.path, binary);
  assert.equal(first.binary.sha256, createHash("sha256").update(readFileSync(binary)).digest("hex"));
  assert.equal(first.db.path, join(home, "records", "records.sqlite"));
  assert.equal(first.db.integrityCheck, "ok");
  assert.equal(first.db.userVersion, 1);
  assert.deepEqual(first.db.migrationsApplied, ["0001_records"]);
  define(home);
  const record = create(home, { number: "A-001", amount: "12.50" });
  const before = history(home, record.id);
  const second = success(home, "selfcheck");
  assert.deepEqual(second.problems, []);
  assert.equal(second.db.userVersion, 1);
  assert.deepEqual(second.db.migrationsApplied, []);
  assert.deepEqual(records(home), [record]);
  assert.deepEqual(history(home, record.id), before);
});

test("commands: every command advertises its database access", (t) => {
  const answer = success(freshHome(t), "commands");
  const expected = [
    { name: "selfcheck", access: "write", input: false },
    { name: "commands", access: "none", input: false },
    { name: "type define", access: "write", input: true },
    { name: "type list", access: "read", input: false },
    { name: "type get", access: "read", input: true },
    { name: "create", access: "write", input: true },
    { name: "update", access: "write", input: true },
    { name: "move", access: "write", input: true },
    { name: "allowed", access: "read", input: true },
    { name: "query", access: "read", input: true },
    { name: "history", access: "read", input: true },
  ];
  const byName = (left, right) => left.name.localeCompare(right.name);
  assert.deepEqual(answer.commands.toSorted(byName), expected.toSorted(byName));
});

test("type-define: presets define, list and get without any preset-specific code", (t) => {
  const home = freshHome(t);
  for (const name of ["invoice", "booking", "inventory-item", "case"]) assert.deepEqual(define(home, preset(name)), { type: name, version: 1 });
  assert.deepEqual(success(home, "type list").types.map(({ type }) => type).sort(), ["booking", "case", "inventory-item", "invoice"]);
  const definition = success(home, "type get", { type: "invoice" }).definition;
  assert.equal(definition.type, "invoice");
  assert.equal(definition.version, 1);
  assert.deepEqual(definition.stages, ["draft", "sent", "paid", "void"]);
  assert.equal(definition.initial, "draft");
  assert.deepEqual(definition.terminal, ["paid", "void"]);
  assert.deepEqual(definition.fields.number, { kind: "string", required: true, unique: true });
  assert.deepEqual(definition.fields.amount, { kind: "money", required: true, unique: false, currency: "USD" });
  assert.deepEqual(definition.transitions, [
    { from: "draft", to: "sent", requires: ["amount", "number"] },
    { from: "sent", to: "paid", requires: [] },
    { from: "draft", to: "void", requires: [] },
    { from: "sent", to: "void", requires: [] },
  ]);
  assert.deepEqual(define(home, definition), { type: "invoice", version: 1 });
  assert.deepEqual(success(home, "type get", { type: "invoice", version: 1 }).definition, definition);
  refused(home, "type get", { type: "absent" }, "E_NOT_FOUND");
});

test("type-versions: compatible additions preserve old records and incompatible changes are refused", (t) => {
  const home = freshHome(t);
  const original = simple();
  define(home, original);
  const first = create(home, { label: "first" }, "first", "entry");
  const secondVersion = { ...original, version: 2, fields: { ...original.fields, detail: { kind: "string" } } };
  assert.deepEqual(define(home, secondVersion), { type: "entry", version: 2 });
  assert.deepEqual(define(home, secondVersion), { type: "entry", version: 2 });
  const second = create(home, { label: "second", detail: "new" }, "second", "entry");
  assert.equal(first.type_version, 1);
  assert.equal(second.type_version, 2);
  refused(home, "update", { id: first.id, fields: { detail: "new" }, idem_key: "old-version" }, "E_INPUT_SCHEMA");
  for (const replacement of [
    { ...secondVersion, version: 3, fields: { ...secondVersion.fields, extra: { kind: "string", required: true } } },
    { ...secondVersion, version: 3, fields: { ...secondVersion.fields, label: { kind: "int", required: true, unique: true } } },
    { ...secondVersion, version: 3, transitions: [] },
    { ...secondVersion, version: 3, initial: "ready" },
  ]) refused(home, "type define", replacement, "E_INCOMPATIBLE");
  assert.equal(success(home, "type get", { type: "entry" }).definition.version, 2);
  assert.equal(records(home, { type: "entry" }).length, 2);
});

test("type-schema: every valid definition fixture is accepted and every invalid fixture is refused", (t) => {
  for (const directory of ["valid", "invalid"]) {
    for (const file of readdirSync(join(repoRoot, "schemas", "examples", directory)).filter((name) => name.endsWith(".json"))) {
      const home = freshHome(t);
      const definition = JSON.parse(readFileSync(join(repoRoot, "schemas", "examples", directory, file), "utf8"));
      const answer = call(home, "type define", definition);
      assert.equal(answer.exit, directory === "valid" ? 0 : 1, `${file}: ${answer.stdout}`);
      if (directory === "invalid") assert.equal(answer.errors[0].code, "E_INPUT_SCHEMA", file);
    }
  }
});

test("create: validated values persist in the initial stage and invalid values write nothing", (t) => {
  const home = freshHome(t);
  define(home);
  const record = create(home, { number: "A-001", amount: "12.500", due: "2028-02-29" });
  assert.equal(record.type, "invoice");
  assert.equal(record.stage, "draft");
  assert.equal(record.type_version, 1);
  assert.deepEqual(record.fields, { number: "A-001", amount: "12.5", due: "2028-02-29" });
  assert.equal(record.created_at, now);
  assert.equal(record.updated_at, now);
  for (const [index, fields] of [{ number: "missing" }, { number: "bad-date", amount: "1", due: "2027-02-29" }, { number: "number-money", amount: 1.2 }, { number: "spaces", amount: " " }, { number: "leading-zeroes", amount: "0012.500" }, { number: "unknown", amount: "1", extra: true }, { number: " ", amount: "1" }].entries()) {
    refused(home, "create", { type: "invoice", fields, idem_key: `bad-${index}` }, "E_INPUT_SCHEMA");
  }
  assert.deepEqual(records(home), [record]);
});

test("field-kinds: all ten kinds round trip and references require an existing record of the named type", (t) => {
  const home = freshHome(t);
  const definition = {
    type: "entry", version: 1, stages: ["open"], initial: "open", transitions: [], terminal: [],
    fields: { name: { kind: "string" }, note: { kind: "text" }, count: { kind: "int" }, ratio: { kind: "decimal" }, cost: { kind: "money", currency: "USD" }, day: { kind: "date" }, at: { kind: "datetime" }, active: { kind: "bool" }, choice: { kind: "enum", values: ["first", "second"] }, parent: { kind: "ref", type: "entry" } },
  };
  define(home, definition);
  const parent = create(home, { name: "parent" }, "parent", "entry");
  const fields = { name: "child", note: "multiple\nlines", count: 0, ratio: "-1.25", cost: "0", day: "2026-01-01", at: "2026-01-01T01:00:00+01:00", active: false, choice: "second", parent: parent.id };
  const record = create(home, fields, "child", "entry");
  assert.deepEqual(record.fields, { ...fields, at: now });
  for (const invalid of [{ count: 1.5 }, { ratio: "NaN" }, { cost: "1e3" }, { day: "2026-04-31" }, { at: "2026-01-01" }, { active: "false" }, { choice: "third" }, { parent: "missing" }]) {
    const answer = call(home, "update", { id: record.id, fields: invalid, idem_key: `invalid-${Object.keys(invalid)[0]}` });
    assert.equal(answer.exit, 1, answer.stdout);
    assert.equal(answer.errors[0].code, "E_INPUT_SCHEMA", answer.stdout);
  }
  assert.deepEqual(records(home, { type: "entry", where: [{ field: "name", op: "eq", value: "child" }] }), [record]);
});

test("update: patches preserve omitted fields, remove optional fields and reject missing required values", (t) => {
  const home = freshHome(t);
  define(home);
  const record = create(home, { number: "A-001", amount: "1", customer: "initial" });
  const changed = success(home, "update", { id: record.id, fields: { amount: "2.50", customer: null }, idem_key: "edit" }, { now: "2026-01-02T00:00:00.000Z" }).record;
  assert.deepEqual(changed.fields, { number: "A-001", amount: "2.5" });
  assert.equal(changed.created_at, now);
  assert.equal(changed.updated_at, "2026-01-02T00:00:00.000Z");
  assert.equal(changed.stage, "draft");
  refused(home, "update", { id: record.id, fields: { number: null }, idem_key: "remove-required" }, "E_INPUT_SCHEMA");
  assert.deepEqual(records(home), [changed]);
  assert.equal(history(home, record.id).length, 2);
});

test("move: only declared moves succeed and terminal stages stay final", (t) => {
  const home = freshHome(t);
  define(home);
  const record = create(home, { number: "A-001", amount: "1" });
  const refusal = refused(home, "move", { id: record.id, to: "paid", idem_key: "jump" }, "E_TRANSITION");
  assert.deepEqual(refusal.allowed, ["sent", "void"]);
  assert.equal(history(home, record.id).length, 1);
  assert.equal(success(home, "move", { id: record.id, to: "sent", idem_key: "send" }).record.stage, "sent");
  assert.equal(success(home, "move", { id: record.id, to: "paid", idem_key: "finish" }).record.stage, "paid");
  for (const to of ["draft", "sent", "paid", "void"]) assert.deepEqual(refused(home, "move", { id: record.id, to, idem_key: `terminal-${to}` }, "E_TRANSITION").allowed, []);
  assert.deepEqual(success(home, "allowed", { id: record.id }).allowed, []);
  assert.equal(history(home, record.id).length, 3);
});

test("allowed: missing transition fields block the move while zero and false satisfy presence", (t) => {
  const home = freshHome(t);
  define(home, simple());
  const record = create(home, { label: "one" }, "create-one", "entry");
  assert.deepEqual(success(home, "allowed", { id: record.id }).allowed, [{ to: "ready", missing: ["ready", "score"] }]);
  refused(home, "move", { id: record.id, to: "ready", idem_key: "blocked" }, "E_TRANSITION");
  success(home, "update", { id: record.id, fields: { score: 0, ready: false }, idem_key: "supply" });
  assert.deepEqual(success(home, "allowed", { id: record.id }).allowed, [{ to: "ready", missing: [] }]);
  assert.equal(success(home, "move", { id: record.id, to: "ready", idem_key: "advance" }).record.stage, "ready");
});

test("uniqueness: conflicting creates and updates roll back while released values become available", (t) => {
  const home = freshHome(t);
  define(home, { ...simple(), fields: { ...simple().fields, optional: { kind: "string", unique: true } } });
  const first = create(home, { label: "first", optional: "shared" }, "first", "entry");
  const second = create(home, { label: "second" }, "second", "entry");
  refused(home, "create", { type: "entry", fields: { label: "first" }, idem_key: "conflict-create" }, "E_UNIQUE");
  refused(home, "update", { id: second.id, fields: { label: "first", note: "must-not-stick" }, idem_key: "conflict-update" }, "E_UNIQUE");
  assert.deepEqual(records(home, { type: "entry", where: [{ field: "label", op: "eq", value: "second" }] }), [second]);
  assert.equal(history(home, second.id).length, 1);
  success(home, "update", { id: first.id, fields: { optional: null }, idem_key: "release" });
  assert.equal(success(home, "update", { id: second.id, fields: { optional: "shared" }, idem_key: "claim" }).record.fields.optional, "shared");
});

test("idempotency: exact retries return the original result and changed requests with the same key are refused", (t) => {
  const home = freshHome(t);
  define(home);
  const input = { type: "invoice", fields: { number: "A-001", amount: "1" }, idem_key: "one" };
  const first = success(home, "create", input);
  assert.deepEqual(success(home, "create", input), first);
  const updated = success(home, "update", { id: first.record.id, fields: { amount: "2" }, idem_key: "two" });
  assert.deepEqual(success(home, "create", input), first);
  assert.deepEqual(records(home), [updated.record]);
  refused(home, "create", { ...input, fields: { number: "A-002", amount: "1" } }, "E_IDEMPOTENCY");
  refused(home, "move", { id: first.record.id, to: "sent", idem_key: "one" }, "E_IDEMPOTENCY");
  assert.equal(history(home, first.record.id).length, 2);
});

const parallelCall = (home, input) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [binary, "create", "--now", now, "--seed", "7"], { env: { ...process.env, AMBITIOUS_HOME: home } });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.on("error", reject);
  child.on("close", (exit) => resolve({ exit, answer: JSON.parse(stdout) }));
  child.stdin.end(JSON.stringify(input));
});

test("concurrency: simultaneous unique claims commit exactly once", async (t) => {
  const home = freshHome(t);
  define(home);
  const attempts = await Promise.all(Array.from({ length: 4 }, (_, index) => parallelCall(home, { type: "invoice", fields: { number: "shared", amount: "1" }, idem_key: `writer-${index}` })));
  assert.equal(attempts.filter(({ exit }) => exit === 0).length, 1, JSON.stringify(attempts));
  assert.ok(attempts.filter(({ exit }) => exit !== 0).every(({ exit, answer }) => exit === 1 && answer.errors[0].code === "E_UNIQUE"), JSON.stringify(attempts));
  assert.equal(records(home).length, 1);
});

test("query: filtering, numeric ordering, stage selection and limits return stable results", (t) => {
  const home = freshHome(t);
  define(home);
  const entries = [
    create(home, { number: "B", amount: "10", customer: "north" }, "b"),
    create(home, { number: "A", amount: "2", customer: "north" }, "a"),
    create(home, { number: "C", amount: "3" }, "c"),
  ];
  success(home, "move", { id: entries[0].id, to: "sent", idem_key: "sent" });
  assert.deepEqual(records(home, { type: "invoice", order: [{ field: "amount", direction: "asc" }] }).map(({ fields }) => fields.number), ["A", "C", "B"]);
  assert.deepEqual(records(home, { type: "invoice", where: [{ field: "customer", op: "eq", value: "north" }, { field: "amount", op: "gte", value: "3" }], limit: 1 }).map(({ fields }) => fields.number), ["B"]);
  assert.deepEqual(records(home, { type: "invoice", stage: "sent" }).map(({ fields }) => fields.number), ["B"]);
  assert.deepEqual(records(home, { type: "invoice", where: [{ field: "customer", op: "exists", value: false }] }).map(({ fields }) => fields.number), ["C"]);
  assert.deepEqual(records(home, { type: "invoice", where: [{ field: "number", op: "in", value: ["A", "C"] }], order: [{ field: "number", direction: "desc" }], limit: 1 }).map(({ fields }) => fields.number), ["C"]);
  assert.deepEqual(records(home, { type: "invoice", where: [{ field: "customer", op: "contains", value: "orth" }] }).map(({ fields }) => fields.number).sort(), ["A", "B"]);
  refused(home, "query", { type: "invoice", where: [{ field: "unknown", op: "eq", value: 1 }] }, "E_INPUT_SCHEMA");
  refused(home, "query", { type: "invoice", limit: -1 }, "E_INPUT_SCHEMA");
});

test("history: events preserve the complete ordered creation, update and move trail", (t) => {
  const home = freshHome(t);
  define(home);
  const record = create(home, { number: "A-001", amount: "1" });
  success(home, "update", { id: record.id, fields: { amount: "2" }, idem_key: "edit" });
  success(home, "move", { id: record.id, to: "sent", idem_key: "send" });
  const events = history(home, record.id);
  assert.deepEqual(events.map(({ kind }) => kind), ["created", "updated", "moved"]);
  assert.deepEqual(events.map(({ idem_key }) => idem_key), ["create-one", "edit", "send"]);
  assert.ok(events.every((event, index) => event.record_id === record.id && event.at === now && typeof event.actor === "string" && (index === 0 || event.seq > events[index - 1].seq)));
  assert.deepEqual(events[1].patch, { amount: "2" });
  assert.equal(events[2].from_stage, "draft");
  assert.equal(events[2].to_stage, "sent");
  refused(home, "history", { id: "missing" }, "E_NOT_FOUND");
});

test("read-only: all analysis commands preserve persistent database bytes and never create a missing database", (t) => {
  const home = freshHome(t);
  define(home);
  const record = create(home, { number: "A-001", amount: "1" });
  const events = history(home, record.id);
  const before = snapshot(join(home, "records"));
  for (const [command, input] of [["type list"], ["type get", { type: "invoice" }], ["allowed", { id: record.id }], ["query", { type: "invoice" }], ["history", { id: record.id }]]) success(home, command, input);
  assert.deepEqual(snapshot(join(home, "records")), before);
  assert.deepEqual(records(home), [record]);
  assert.deepEqual(history(home, record.id), events);
  for (const [command, input] of [["type list"], ["type get", { type: "invoice" }], ["allowed", { id: "missing" }], ["query", { type: "invoice" }], ["history", { id: "missing" }]]) {
    const empty = freshHome(t);
    const answer = call(empty, command, input);
    assert.equal(answer.exit, 2);
    assert.equal(answer.errors[0].code, "E_MIGRATION");
    assert.deepEqual(readdirSync(empty), []);
  }
});

test("determinism: identical command sequences produce byte-identical output on independent homes", (t) => {
  const homes = [freshHome(t), freshHome(t)];
  const outputs = homes.map((home) => {
    const defined = call(home, "type define", preset("invoice")).stdout;
    const created = call(home, "create", { type: "invoice", fields: { number: "A", amount: "2" }, idem_key: "one" });
    const moved = call(home, "move", { id: created.data.record.id, to: "sent", idem_key: "two" }).stdout;
    return [defined, created.stdout, moved, call(home, "query", { type: "invoice" }).stdout];
  });
  assert.deepEqual(outputs[0], outputs[1]);
});

test("input-file: JSON input files behave like stdin and --db selects a separate database", (t) => {
  const home = freshHome(t);
  const file = join(home, "type.json");
  writeFileSync(file, JSON.stringify(preset("invoice")));
  const db = join(home, "custom.sqlite");
  assert.deepEqual(success(home, "type define", undefined, { args: ["--in", file, "--db", db] }), { type: "invoice", version: 1 });
  assert.equal(existsSync(db), true);
  assert.equal(existsSync(join(home, "records")), false);
  assert.equal(success(home, "type get", { type: "invoice" }, { args: ["--db", db] }).definition.type, "invoice");
});

test("bundle: a copied single-file binary runs with no neighboring source or dependencies", (t) => {
  const home = freshHome(t);
  const directory = join(home, "standalone");
  mkdirSync(directory);
  const target = join(directory, "ambitious-records.mjs");
  copyFileSync(binary, target);
  assert.deepEqual(success(home, "type define", preset("invoice"), { binary: target }), { type: "invoice", version: 1 });
  assert.deepEqual(success(home, "selfcheck", undefined, { binary: target }).problems, []);
});


test("uniqueness: claims span compatible versions of one type and remain independent between types", (t) => {
  const home = freshHome(t);
  const definition = simple();
  define(home, definition);
  const first = create(home, { label: "shared" }, "first", "entry");
  define(home, { ...definition, version: 2, fields: { ...definition.fields, detail: { kind: "text" } } });
  refused(home, "create", { type: "entry", fields: { label: "shared", detail: "new-version" }, idem_key: "conflict" }, "E_UNIQUE");
  define(home, { ...definition, type: "other-entry" });
  const other = create(home, { label: "shared" }, "other", "other-entry");
  assert.deepEqual(records(home, { type: "entry" }), [first]);
  assert.deepEqual(records(home, { type: "other-entry" }), [other]);
});
