import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";
import * as fc from "fast-check";
import { call, create, define, history, makeHome, now, records, success } from "./helpers.mjs";

const definition = {
  type: "entry", version: 1,
  fields: { label: { kind: "string", required: true, unique: true }, note: { kind: "text" }, score: { kind: "int" }, ready: { kind: "bool" } },
  stages: ["draft", "ready", "done"], initial: "draft", terminal: ["done"],
  transitions: [
    { from: "draft", to: "ready", requires: ["score", "ready"] },
    { from: "ready", to: "draft" },
    { from: "ready", to: "done" },
  ],
};

const patchFields = (fields, patch) => {
  const changed = { ...fields };
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) delete changed[name];
    else changed[name] = value;
  }
  return changed;
};

const replayEvents = (events) => {
  const [created, ...changes] = events;
  assert.equal(created.kind, "created");
  let record = {
    id: created.record_id, type: created.type, type_version: created.type_version,
    stage: created.to_stage, fields: created.patch, created_at: created.at, updated_at: created.at,
  };
  for (const event of changes) {
    assert.equal(event.record_id, record.id);
    if (event.kind === "updated") record = { ...record, fields: patchFields(record.fields, event.patch), updated_at: event.at };
    else {
      assert.equal(event.kind, "moved");
      assert.equal(event.from_stage, record.stage);
      record = { ...record, stage: event.to_stage, updated_at: event.at };
    }
  }
  return record;
};

const update = fc.record({
  kind: fc.constant("update"),
  fields: fc.record({
    note: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
    score: fc.option(fc.integer({ min: -1000, max: 1000 }), { nil: null }),
    ready: fc.option(fc.boolean(), { nil: null }),
  }),
});
const move = fc.record({ kind: fc.constant("move"), to: fc.constantFrom("draft", "ready", "done", "absent") });

const canMove = (record, to) => record.stage === "draft"
  ? to === "ready" && Object.hasOwn(record.fields, "score") && Object.hasOwn(record.fields, "ready")
  : record.stage === "ready" && (to === "draft" || to === "done");

test("replay: generated updates, moves, refusals and retries preserve the same record as its complete event history", () => {
  fc.assert(fc.property(fc.array(fc.oneof(update, move), { minLength: 1, maxLength: 14 }), (operations) => {
    const home = makeHome();
    try {
      define(home, definition);
      let expected = create(home, { label: "one" }, "created", "entry");
      assert.deepEqual(expected.fields, { label: "one" });
      assert.equal(expected.stage, "draft");
      let eventCount = 1;
      for (const [index, operation] of operations.entries()) {
        const at = `2026-01-01T00:00:${String(index + 1).padStart(2, "0")}.000Z`;
        const input = {
          id: expected.id, idem_key: `operation-${index}`, actor: "operator",
          ...(operation.kind === "update" ? { fields: operation.fields } : { to: operation.to }),
        };
        const accepts = operation.kind === "update" || canMove(expected, operation.to);
        const answer = call(home, operation.kind, input, { now: at });
        assert.equal(answer.exit, accepts ? 0 : 1, answer.stdout);
        if (accepts) {
          expected = {
            ...expected,
            ...(operation.kind === "update" ? { fields: patchFields(expected.fields, operation.fields) } : { stage: operation.to }),
            updated_at: at,
          };
          assert.deepEqual(answer.data.record, expected);
          assert.deepEqual(success(home, operation.kind, input, { now: "2026-01-02T00:00:00.000Z" }), answer.data);
          eventCount += 1;
        } else assert.equal(answer.errors[0].code, "E_TRANSITION");
        const events = history(home, expected.id);
        assert.equal(events.length, eventCount);
        assert.equal(events[0].at, now);
        assert.ok(events.slice(1).every((event) => event.actor === "operator"));
        assert.equal(new Set(events.map(({ idem_key }) => idem_key)).size, events.length);
        assert.ok(events.every((event, offset) => offset === 0 || event.seq > events[offset - 1].seq));
        assert.deepEqual(replayEvents(events), expected);
        assert.deepEqual(records(home, { type: "entry" }), [expected]);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }), { numRuns: 25, seed: 20261114 });
});
