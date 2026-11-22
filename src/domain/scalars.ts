import { failure } from "@ambitious/kit/domain/failure";
import { isRecord } from "@ambitious/kit/domain/json";
import { isFieldName, isStageName, isTypeName } from "./types.ts";
import type { Actor, CalendarDate, DecimalText, EventSeq, FieldName, IdemKey, Instant, RecordId, StageName, TypeName, TypeVersion } from "./types.ts";

export const invalid = (message: string, hint = "Use the documented command shape and field values."): never => {
  throw failure("E_INPUT_SCHEMA", message, hint);
};

export const TYPE_NAME_RULE = "must be lower-case words joined by hyphens, starting with a letter, up to 64 characters";
export const TYPE_NAME_HINT = "Write the type name in lower case, starting with a letter, with hyphens between words, not underscores, spaces or capitals: inventory-item, not inventory_item. Field and stage names use underscores.";

export const object = (raw: unknown, label = "Input"): Readonly<Record<string, unknown>> => {
  if (!isRecord(raw)) return invalid(`${label} must be an object.`);
  return raw;
};

export const onlyKeys = (raw: Readonly<Record<string, unknown>>, keys: readonly string[]): void => {
  if (Object.keys(raw).some((key) => !keys.includes(key))) invalid("Input contains an unknown property.");
};

export const string = (raw: unknown, label: string): string => {
  if (typeof raw !== "string") return invalid(`${label} must be a string.`);
  return raw;
};

export const typeName = (raw: unknown): TypeName => {
  const value = string(raw, "type");
  if (!isTypeName(value)) return invalid(`type ${TYPE_NAME_RULE}.`, TYPE_NAME_HINT);
  return value;
};

export const fieldName = (raw: unknown): FieldName => {
  const value = string(raw, "field");
  if (!isFieldName(value)) return invalid("field must be lower-case words joined by underscores, up to 64 characters.");
  return value;
};

export const stageName = (raw: unknown): StageName => {
  const value = string(raw, "stage");
  if (!isStageName(value)) return invalid("stage must be lower-case words joined by underscores, up to 64 characters.");
  return value;
};

const isVersion = (value: unknown): value is TypeVersion =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000;

export const typeVersion = (raw: unknown): TypeVersion => {
  if (!isVersion(raw)) return invalid("version must be an integer from 1 to 1000000.");
  return raw;
};

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\s\u0000-\u001f\u007f]/u.test(value);
const isRecordId = (value: unknown): value is RecordId => isIdentifier(value);
const isIdemKey = (value: unknown): value is IdemKey => isIdentifier(value);
const isActor = (value: unknown): value is Actor => isIdentifier(value);
const isEventSeq = (value: unknown): value is EventSeq => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export const recordId = (raw: unknown): RecordId => {
  if (!isRecordId(raw)) return invalid("id must be 1 to 200 characters without whitespace or control characters.");
  return raw;
};
export const idemKey = (raw: unknown): IdemKey => {
  if (!isIdemKey(raw)) return invalid("idem_key must be 1 to 200 characters without whitespace or control characters.");
  return raw;
};
export const actor = (raw: unknown = "bot"): Actor => {
  if (!isActor(raw)) return invalid("actor must be 1 to 200 characters without whitespace or control characters.");
  return raw;
};
export const eventSeq = (raw: unknown): EventSeq => {
  if (!isEventSeq(raw)) return invalid("seq must be a positive safe integer.");
  return raw;
};

const isCalendarDate = (value: string): value is CalendarDate => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export const calendarDate = (raw: unknown): CalendarDate => {
  const value = string(raw, "date");
  if (!isCalendarDate(value)) return invalid("date must be a valid calendar date written YYYY-MM-DD.");
  return value;
};
const isInstant = (value: string): value is Instant => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value);
export const instant = (raw: unknown): Instant => {
  const value = string(raw, "datetime");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    return invalid("datetime must include seconds and a timezone, with at most millisecond precision.");
  }
  calendarDate(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return invalid("datetime has an invalid time.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return invalid("datetime must be a valid instant.");
  const normalized = date.toISOString();
  if (!isInstant(normalized)) return invalid("datetime must have a four-digit year.");
  return normalized;
};
const isDecimal = (value: string): value is DecimalText => /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) && value.length <= 256;
export const decimalText = (raw: unknown): DecimalText => {
  const value = string(raw, "decimal or money");
  if (!isDecimal(value)) return invalid("decimal and money values must be exact decimal strings, up to 256 characters, without exponents or leading zeroes.");
  let normalized = value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
  if (normalized === "-0") normalized = "0";
  if (!isDecimal(normalized)) return invalid("decimal value could not be normalized.");
  return normalized;
};
