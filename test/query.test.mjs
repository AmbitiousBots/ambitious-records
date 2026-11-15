import assert from "node:assert/strict";
import { test } from "node:test";
import { create, define, freshHome, records, refused } from "./helpers.mjs";

test("query: exact decimal filters and ordering preserve values beyond floating-point precision", (t) => {
  const home = freshHome(t);
  define(home, {
    type: "entry", version: 1, fields: { value: { kind: "decimal", required: true } },
    stages: ["open"], initial: "open", transitions: [], terminal: [],
  });
  const values = ["9007199254740993.2", "-9007199254740993.2", "9007199254740993.1", "-9007199254740993.1", "0"];
  for (const [index, value] of values.entries()) create(home, { value }, `value-${index}`, "entry");
  assert.deepEqual(records(home, { type: "entry", order: [{ field: "value", direction: "asc" }] }).map(({ fields }) => fields.value), ["-9007199254740993.2", "-9007199254740993.1", "0", "9007199254740993.1", "9007199254740993.2"]);
  assert.deepEqual(records(home, { type: "entry", where: [{ field: "value", op: "gt", value: "9007199254740993.1" }] }).map(({ fields }) => fields.value), ["9007199254740993.2"]);
  assert.deepEqual(records(home, { type: "entry", where: [{ field: "value", op: "eq", value: "9007199254740993.200" }] }).map(({ fields }) => fields.value), ["9007199254740993.2"]);
  refused(home, "query", { type: "entry", where: [{ field: "value", op: "contains", value: "3" }] }, "E_INPUT_SCHEMA");
  refused(home, "query", { type: "entry", where: [{ field: "value", op: "gt", value: 1 }] }, "E_INPUT_SCHEMA");
});

test("query: missing optional values sort last with stable ties and every comparison operator works", (t) => {
  const home = freshHome(t);
  define(home, {
    type: "entry", version: 1, fields: { label: { kind: "string", required: true }, value: { kind: "int" } },
    stages: ["open"], initial: "open", transitions: [], terminal: [],
  });
  const one = create(home, { label: "one", value: 1 }, "one", "entry");
  const two = create(home, { label: "two", value: 2 }, "two", "entry");
  const missing = create(home, { label: "missing" }, "missing", "entry");
  for (const [op, value, wanted] of [["eq", 1, [one]], ["ne", 1, [two]], ["lt", 2, [one]], ["lte", 1, [one]], ["gt", 1, [two]], ["gte", 2, [two]], ["eq", null, [missing]], ["ne", null, [one, two]], ["exists", true, [one, two]]]) {
    assert.deepEqual(records(home, { type: "entry", where: [{ field: "value", op, value }], order: [{ field: "value" }] }), wanted);
  }
  assert.deepEqual(records(home, { type: "entry", order: [{ field: "value", direction: "desc" }] }), [two, one, missing]);
  assert.deepEqual(records(home, { type: "entry", order: [{ field: "value", direction: "asc" }] }), [one, two, missing]);
  refused(home, "query", { type: "entry", where: [{ field: "value", op: "exists", value: "yes" }] }, "E_INPUT_SCHEMA");
  refused(home, "query", { type: "entry", order: [{ field: "missing" }] }, "E_INPUT_SCHEMA");
  refused(home, "query", { type: "entry", stage: "missing" }, "E_INPUT_SCHEMA");
});
