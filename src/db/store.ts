import { createHash } from "node:crypto";
import type { Db } from "@ambitious/kit/db/open-db";
import type { Clock } from "@ambitious/kit/domain/clock";
import { failure } from "@ambitious/kit/domain/failure";
import type { JsonObject } from "@ambitious/kit/domain/json";
import { assertCompatible, parseRecordType, typeDocument } from "../domain/definition.ts";
import { applyPatch, assertRequired, fieldsDocument, parseFields, parsePatch, patchDocument } from "../domain/fields.ts";
import type { CreateInput, MoveInput, UpdateInput } from "../domain/input.ts";
import { canonicalJson } from "../domain/input.ts";
import { allowedMoves, moveOrThrow, recordDocument } from "../domain/records.ts";
import { instant, recordId } from "../domain/scalars.ts";
import type { FieldPatch, RecordType, StoredRecord } from "../domain/types.ts";
import { getRecord, getType, jsonObject, readRecord, storedJson, textColumn } from "./rows.ts";

export const defineType = (db: Db, definition: RecordType): JsonObject => {
  const document = canonicalJson(typeDocument(definition));
  const same = db.prepare("SELECT json FROM types WHERE type = ? AND version = ?").get(definition.type, definition.version);
  if (same !== undefined) {
    if (textColumn(same, "json") !== document) throw failure("E_INCOMPATIBLE", "This type version already has a different definition.", "Use a higher version for a compatible extension.");
    return { type: definition.type, version: definition.version };
  }
  const previous = db.prepare("SELECT json FROM types WHERE type = ? ORDER BY version DESC LIMIT 1").get(definition.type);
  if (previous !== undefined) assertCompatible(parseRecordType(storedJson(textColumn(previous, "json"))), definition);
  db.prepare("INSERT INTO types(type, version, json) VALUES (?, ?, ?)").run(definition.type, definition.version, document);
  return { type: definition.type, version: definition.version };
};

export const listTypes = (db: Db): JsonObject => ({
  types: db.prepare("SELECT json FROM types ORDER BY type, version").all().map((row) => typeDocument(parseRecordType(storedJson(textColumn(row, "json"))))),
});

const retry = (db: Db, key: string, request: string): JsonObject | undefined => {
  const event = db.prepare("SELECT request_json, result_json FROM record_events WHERE idem_key = ?").get(key);
  if (event === undefined) return undefined;
  if (textColumn(event, "request_json") !== request) {
    throw failure("E_IDEMPOTENCY", "This idempotency key belongs to a different request.", "Retry the original request unchanged, or use a new idem_key.");
  }
  return jsonObject(storedJson(textColumn(event, "result_json")));
};

const claimFields = (db: Db, definition: RecordType, record: StoredRecord): void => {
  for (const [name, value] of record.fields) {
    const field = definition.fields.get(name);
    if (field?.kind === "ref" && value.kind === "ref") {
      const target = db.prepare("SELECT type FROM records WHERE id = ?").get(value.value);
      if (target === undefined || target.type !== field.type) {
        throw failure("E_INPUT_SCHEMA", `Field ${name} must reference an existing record of type ${field.type}.`, "Create the referenced record first and use its id.");
      }
    }
    if (field?.unique) {
      const existing = db.prepare("SELECT record_id FROM uniques WHERE type = ? AND field = ? AND value = ?").get(record.type, name, JSON.stringify(value.value));
      if (existing !== undefined && existing.record_id !== record.id) {
        throw failure("E_UNIQUE", `Field ${name} must be unique for this type.`, "Use a value not already held by another record.", { field: name });
      }
    }
  }
  db.prepare("DELETE FROM uniques WHERE record_id = ?").run(record.id);
  for (const [name, value] of record.fields) {
    if (definition.fields.get(name)?.unique) {
      db.prepare("INSERT INTO uniques(type, field, value, record_id) VALUES (?, ?, ?, ?)").run(record.type, name, JSON.stringify(value.value), record.id);
    }
  }
};

type EventInput = {
  readonly kind: "created" | "updated" | "moved";
  readonly record: StoredRecord;
  readonly from: string | null;
  readonly to: string | null;
  readonly patch: FieldPatch;
  readonly actor: string;
  readonly key: string;
  readonly request: string;
};

const appendEvent = (db: Db, event: EventInput): JsonObject => {
  const result = { record: recordDocument(event.record) };
  db.prepare(`INSERT INTO record_events(record_id, kind, type, type_version, from_stage, to_stage, patch_json, at, actor, idem_key, request_json, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    event.record.id, event.kind, event.record.type, event.record.typeVersion, event.from, event.to,
    canonicalJson(patchDocument(event.patch)), event.record.updatedAt, event.actor, event.key, event.request, canonicalJson(result),
  );
  return result;
};

export const createRecord = (db: Db, input: CreateInput, clock: Clock): JsonObject => {
  const request = canonicalJson({ command: "create", ...input });
  const previous = retry(db, input.idemKey, request);
  if (previous !== undefined) return previous;
  const definition = getType(db, input.type);
  const now = instant(clock.now().toISOString());
  const record: StoredRecord = {
    id: recordId(`rec_${createHash("sha256").update(input.idemKey).digest("hex")}`),
    type: definition.type, typeVersion: definition.version, stage: definition.initial,
    fields: parseFields(definition, input.fields), createdAt: now, updatedAt: now,
  };
  db.prepare("INSERT INTO records(id, type, type_version, stage, fields_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(record.id, record.type, record.typeVersion, record.stage, canonicalJson(fieldsDocument(record.fields)), now, now);
  claimFields(db, definition, record);
  return appendEvent(db, { kind: "created", record, from: null, to: record.stage, patch: record.fields, actor: input.actor, key: input.idemKey, request });
};

export const updateRecord = (db: Db, input: UpdateInput, clock: Clock): JsonObject => {
  const request = canonicalJson({ command: "update", ...input });
  const previous = retry(db, input.idemKey, request);
  if (previous !== undefined) return previous;
  const current = getRecord(db, input.id);
  const definition = getType(db, current.type, current.typeVersion);
  const patch = parsePatch(definition, input.fields);
  const record = { ...current, fields: applyPatch(current.fields, patch), updatedAt: instant(clock.now().toISOString()) };
  assertRequired(definition, record.fields);
  claimFields(db, definition, record);
  db.prepare("UPDATE records SET fields_json = ?, updated_at = ? WHERE id = ?").run(canonicalJson(fieldsDocument(record.fields)), record.updatedAt, record.id);
  return appendEvent(db, { kind: "updated", record, from: null, to: null, patch, actor: input.actor, key: input.idemKey, request });
};

export const moveRecord = (db: Db, input: MoveInput, clock: Clock): JsonObject => {
  const request = canonicalJson({ command: "move", ...input });
  const previous = retry(db, input.idemKey, request);
  if (previous !== undefined) return previous;
  const current = getRecord(db, input.id);
  const definition = getType(db, current.type, current.typeVersion);
  const transition = moveOrThrow(definition, current, input.to);
  const record = { ...current, stage: transition.to, updatedAt: instant(clock.now().toISOString()) };
  db.prepare("UPDATE records SET stage = ?, updated_at = ? WHERE id = ?").run(record.stage, record.updatedAt, record.id);
  return appendEvent(db, { kind: "moved", record, from: current.stage, to: record.stage, patch: new Map(), actor: input.actor, key: input.idemKey, request });
};

export const allowed = (db: Db, id: string): JsonObject => {
  const record = getRecord(db, id);
  return { allowed: allowedMoves(getType(db, record.type, record.typeVersion), record).map(({ to, missing }) => ({ to, missing })) };
};

export const recordsOfType = (db: Db, type: string): readonly StoredRecord[] =>
  db.prepare("SELECT * FROM records WHERE type = ? ORDER BY id").all(type).map((row) => readRecord(db, row));

export const history = (db: Db, id: string): JsonObject => {
  getRecord(db, id);
  return {
    events: db.prepare("SELECT * FROM record_events WHERE record_id = ? ORDER BY seq").all(id).map((row) => ({
      seq: Number(row.seq), record_id: textColumn(row, "record_id"), kind: textColumn(row, "kind"),
      type: textColumn(row, "type"), type_version: Number(row.type_version),
      from_stage: typeof row.from_stage === "string" ? row.from_stage : null,
      to_stage: typeof row.to_stage === "string" ? row.to_stage : null,
      patch: jsonObject(storedJson(textColumn(row, "patch_json"))),
      at: textColumn(row, "at"), actor: textColumn(row, "actor"), idem_key: textColumn(row, "idem_key"),
    })),
  };
};
