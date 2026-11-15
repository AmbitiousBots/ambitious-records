import { isRecord } from "@ambitious/kit/domain/json";
import type { JsonObject, JsonValue } from "@ambitious/kit/domain/json";
import { actor, fieldName, idemKey, invalid, object, onlyKeys, recordId, stageName, typeName, typeVersion } from "./scalars.ts";
import type { FieldName, StageName, TypeName } from "./types.ts";

const rawFields = (raw: unknown, allowNull = true): JsonObject => {
  const result = object(raw, "fields");
  for (const [name, value] of Object.entries(result)) {
    fieldName(name);
    if (value === null && !allowNull) return invalid("Create fields cannot be null; omit optional fields instead.");
    if (value !== null && typeof value !== "string" && typeof value !== "boolean" && (typeof value !== "number" || !Number.isFinite(value))) return invalid("Each field value must be a string, boolean, number or null.");
  }
  return jsonObject(result);
};

export const parseCreate = (raw: unknown) => {
  const input = object(raw);
  onlyKeys(input, ["type", "fields", "idem_key", "actor"]);
  return { type: typeName(input.type), fields: rawFields(input.fields, false), idemKey: idemKey(input.idem_key), actor: actor(input.actor) };
};
export const parseUpdate = (raw: unknown) => {
  const input = object(raw);
  onlyKeys(input, ["id", "fields", "idem_key", "actor"]);
  return { id: recordId(input.id), fields: rawFields(input.fields), idemKey: idemKey(input.idem_key), actor: actor(input.actor) };
};
export const parseMove = (raw: unknown) => {
  const input = object(raw);
  onlyKeys(input, ["id", "to", "idem_key", "actor"]);
  return { id: recordId(input.id), to: stageName(input.to), idemKey: idemKey(input.idem_key), actor: actor(input.actor) };
};
export const parseId = (raw: unknown) => {
  const input = object(raw);
  onlyKeys(input, ["id"]);
  return { id: recordId(input.id) };
};
export const parseTypeGet = (raw: unknown) => {
  const input = object(raw);
  onlyKeys(input, ["type", "version"]);
  return { type: typeName(input.type), ...(input.version === undefined ? {} : { version: typeVersion(input.version) }) };
};
export type CreateInput = ReturnType<typeof parseCreate>;
export type UpdateInput = ReturnType<typeof parseUpdate>;
export type MoveInput = ReturnType<typeof parseMove>;

export const QUERY_OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "exists"] as const;
export type QueryOperator = (typeof QUERY_OPERATORS)[number];
export type QueryFilter = { readonly field: FieldName; readonly op: QueryOperator; readonly value: JsonValue };
export type QueryOrder = { readonly field: FieldName; readonly direction: "asc" | "desc" };
export type Query = { readonly type: TypeName; readonly stage?: StageName; readonly where: readonly QueryFilter[]; readonly order: readonly QueryOrder[]; readonly limit: number };
const isOperator = (raw: unknown): raw is QueryOperator => QUERY_OPERATORS.some((operator) => raw === operator);
const parseFilter = (raw: unknown): QueryFilter => {
  const input = object(raw, "where entry");
  onlyKeys(input, ["field", "op", "value"]);
  if (!isOperator(input.op)) return invalid("where.op must be eq, ne, gt, gte, lt, lte, in, contains or exists.");
  if (!Object.hasOwn(input, "value")) return invalid("where entries require value.");
  return { field: fieldName(input.field), op: input.op, value: jsonValue(input.value) };
};
const parseOrder = (raw: unknown): QueryOrder => {
  const input = object(raw, "order entry");
  onlyKeys(input, ["field", "direction"]);
  const direction = input.direction === undefined ? "asc" : input.direction;
  if (direction !== "asc" && direction !== "desc") return invalid("order.direction must be asc or desc.");
  return { field: fieldName(input.field), direction };
};
export const parseQuery = (raw: unknown): Query => {
  const input = object(raw);
  onlyKeys(input, ["type", "stage", "where", "order", "limit"]);
  const where: unknown = input.where === undefined ? [] : input.where;
  const order: unknown = input.order === undefined ? [] : input.order;
  const limit = input.limit === undefined ? 100 : input.limit;
  if (!Array.isArray(where) || where.length > 64) return invalid("where must be a list of up to 64 filters.");
  if (!Array.isArray(order) || order.length > 64) return invalid("order must be a list of up to 64 fields.");
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) return invalid("limit must be an integer from 1 to 1000.");
  return { type: typeName(input.type), ...(input.stage === undefined ? {} : { stage: stageName(input.stage) }), where: where.map(parseFilter), order: order.map(parseOrder), limit };
};

export const jsonValue = (raw: unknown): JsonValue => {
  if (raw === null || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (Array.isArray(raw)) return raw.map(jsonValue);
  if (isRecord(raw)) return jsonObject(raw);
  return invalid("Input must contain only JSON values.");
};
export const jsonObject = (raw: unknown): JsonObject => {
  const input = object(raw);
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, value]) => [key, jsonValue(value)]));
};
export const canonicalJson = (raw: unknown): string => JSON.stringify(jsonValue(raw));
