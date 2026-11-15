import type { Db } from "@ambitious/kit/db/open-db";
import { failure } from "@ambitious/kit/domain/failure";
import type { JsonObject } from "@ambitious/kit/domain/json";
import { parseRecordType } from "../domain/definition.ts";
import { parseFields } from "../domain/fields.ts";
import { instant, recordId, stageName, typeName, typeVersion } from "../domain/scalars.ts";
import type { RecordType, StoredRecord } from "../domain/types.ts";

type Row = Readonly<Record<string, unknown>>;

export const textColumn = (row: Row, name: string): string => {
  const value = row[name];
  if (typeof value !== "string") throw failure("E_DB", `Stored ${name} is not text.`, "Run selfcheck and restore a valid database backup.");
  return value;
};

export const numberColumn = (row: Row, name: string): number => {
  const value = row[name];
  if (typeof value !== "number") throw failure("E_DB", `Stored ${name} is not a number.`, "Run selfcheck and restore a valid database backup.");
  return value;
};

export const storedJson = (text: string): unknown => JSON.parse(text);

export const getType = (db: Db, name: string, version?: number): RecordType => {
  const row = version === undefined
    ? db.prepare("SELECT json FROM types WHERE type = ? ORDER BY version DESC LIMIT 1").get(name)
    : db.prepare("SELECT json FROM types WHERE type = ? AND version = ?").get(name, version);
  if (row === undefined) throw failure("E_NOT_FOUND", "The record type was not found.", "Define the type first, or choose a listed type and version.");
  return parseRecordType(storedJson(textColumn(row, "json")));
};

export const readRecord = (db: Db, row: Row): StoredRecord => {
  const type = typeName(textColumn(row, "type"));
  const version = typeVersion(numberColumn(row, "type_version"));
  const definition = getType(db, type, version);
  return {
    id: recordId(textColumn(row, "id")),
    type,
    typeVersion: version,
    stage: stageName(textColumn(row, "stage")),
    fields: parseFields(definition, storedJson(textColumn(row, "fields_json"))),
    createdAt: instant(textColumn(row, "created_at")),
    updatedAt: instant(textColumn(row, "updated_at")),
  };
};

export const getRecord = (db: Db, id: string): StoredRecord => {
  const row = db.prepare("SELECT * FROM records WHERE id = ?").get(id);
  if (row === undefined) throw failure("E_NOT_FOUND", "The record was not found.", "Use an id returned by create or query.");
  return readRecord(db, row);
};

export const jsonObject = (value: unknown): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw failure("E_DB", "The stored response is not an object.", "Run selfcheck and restore a valid database backup.");
  }
  const isJson = (item: unknown): item is JsonObject => Object.values(item ?? {}).every((part) =>
    part === null || typeof part === "string" || typeof part === "number" || typeof part === "boolean" ||
    (typeof part === "object" && isJson(part)));
  if (!isJson(value)) throw failure("E_DB", "The stored response is not JSON.", "Run selfcheck and restore a valid database backup.");
  return value;
};
