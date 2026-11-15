import { failure } from "@ambitious/kit/domain/failure";
import type { JsonObject } from "@ambitious/kit/domain/json";
import { applyPatch, fieldsDocument, patchDocument, present } from "./fields.ts";
import { err, ok } from "./types.ts";
import type { AllowedMoves, DecideMove, RecordEvent, RecordType, Replay, StoredRecord, Transition } from "./types.ts";

export const allowedMoves: AllowedMoves = (definition, record) => definition.terminal.has(record.stage) ? [] :
  definition.transitions.filter(({ from }) => from === record.stage).map(({ to, requires }) => ({
    to,
    missing: [...requires].filter((name) => !present(record.fields.get(name))).sort(),
  }));

export const decideMove: DecideMove = (definition, record, to) => {
  if (definition.terminal.has(record.stage)) return err({ reason: "terminal-stage", stage: record.stage, allowed: [] });
  const allowed = allowedMoves(definition, record).map((move) => move.to);
  const transition = definition.transitions.find((candidate) => candidate.from === record.stage && candidate.to === to);
  if (transition === undefined) return err({ reason: "not-declared", from: record.stage, to, allowed });
  const [first, ...rest] = [...transition.requires].filter((name) => !present(record.fields.get(name))).sort();
  if (first !== undefined) return err({ reason: "missing-required-fields", from: record.stage, to: transition.to, missing: [first, ...rest], allowed });
  return ok(transition);
};

export const moveOrThrow = (definition: RecordType, record: StoredRecord, to: string): Transition => {
  const result = decideMove(definition, record, to);
  if (result.ok) return result.value;
  const refusal = result.error;
  const missing = refusal.reason === "missing-required-fields" ? refusal.missing : [];
  throw failure("E_TRANSITION", refusal.reason === "terminal-stage" ? "A record in a terminal stage cannot move." :
    refusal.reason === "not-declared" ? "That move is not declared for the current stage." : "The move requires fields that have no value.",
  "Read allowed for possible moves and missing fields, then update fields or choose an allowed stage.", { allowed: refusal.allowed, missing });
};

export const replay: Replay = ([created, ...events]) => {
  let record: StoredRecord = {
    id: created.recordId,
    type: created.type,
    typeVersion: created.typeVersion,
    stage: created.toStage,
    fields: applyPatch(new Map(), created.patch),
    createdAt: created.at,
    updatedAt: created.at,
  };
  for (const event of events) {
    switch (event.kind) {
      case "created": throw failure("E_INTERNAL", "Record history contains a second creation.", "Restore a consistent record history.");
      case "updated": record = { ...record, fields: applyPatch(record.fields, event.patch), updatedAt: event.at }; break;
      case "moved": record = { ...record, stage: event.toStage, updatedAt: event.at }; break;
    }
  }
  return record;
};

export const recordDocument = (record: StoredRecord): JsonObject => ({
  id: record.id,
  type: record.type,
  type_version: record.typeVersion,
  stage: record.stage,
  fields: fieldsDocument(record.fields),
  created_at: record.createdAt,
  updated_at: record.updatedAt,
});

export const eventDocument = (event: RecordEvent): JsonObject => ({
  seq: event.seq,
  record_id: event.recordId,
  kind: event.kind,
  at: event.at,
  actor: event.actor,
  idem_key: event.idemKey,
  ...(event.kind === "created" ? { type: event.type, type_version: event.typeVersion, from_stage: null, to_stage: event.toStage, patch: patchDocument(event.patch) } :
    event.kind === "updated" ? { from_stage: null, to_stage: null, patch: patchDocument(event.patch) } :
      { from_stage: event.fromStage, to_stage: event.toStage, patch: {} }),
});
