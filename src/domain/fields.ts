import type { JsonObject } from "@ambitious/kit/domain/json";
import { calendarDate, decimalText, fieldName, instant, invalid, object, recordId, string } from "./scalars.ts";
import type { Field, FieldName, FieldPatch, FieldValue, FieldValues, RecordType } from "./types.ts";

export const parseFieldValue = (field: Field, raw: unknown): FieldValue => {
  switch (field.kind) {
    case "string": case "text": return { kind: field.kind, value: string(raw, field.kind) };
    case "enum": {
      const value = string(raw, "enum");
      if (!field.values.includes(value)) return invalid("enum value must be one of the declared values.");
      return { kind: "enum", value };
    }
    case "int": {
      if (typeof raw !== "number" || !Number.isSafeInteger(raw)) return invalid("int values must be safe integers.");
      return { kind: "int", value: Object.is(raw, -0) ? 0 : raw };
    }
    case "decimal": case "money": return { kind: field.kind, value: decimalText(raw) };
    case "date": return { kind: "date", value: calendarDate(raw) };
    case "datetime": return { kind: "datetime", value: instant(raw) };
    case "bool": {
      if (typeof raw !== "boolean") return invalid("bool values must be true or false.");
      return { kind: "bool", value: raw };
    }
    case "ref": return { kind: "ref", value: recordId(raw) };
  }
};

export const present = (value: FieldValue | undefined): boolean =>
  value !== undefined && (typeof value.value !== "string" || value.value.trim().length > 0);

export const assertRequired = (definition: RecordType, fields: FieldValues): void => {
  const missing = [...definition.fields].filter(([name, field]) => field.required && !present(fields.get(name))).map(([name]) => name);
  if (missing.length > 0) return invalid(`Required fields need values: ${missing.join(", ")}.`);
};

export const parsePatch = (definition: RecordType, raw: unknown): FieldPatch => {
  const input = object(raw, "fields");
  const patch = new Map<FieldName, FieldValue | null>();
  for (const [name, value] of Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const key = fieldName(name);
    const field = definition.fields.get(key);
    if (field === undefined) return invalid(`Unknown field ${name}.`);
    patch.set(key, value === null ? null : parseFieldValue(field, value));
  }
  return patch;
};

export const applyPatch = (fields: FieldValues, patch: FieldPatch): FieldValues => {
  const result = new Map(fields);
  for (const [name, value] of patch) {
    if (value === null) result.delete(name);
    else result.set(name, value);
  }
  return result;
};

export const parseFields = (definition: RecordType, raw: unknown): FieldValues => {
  const values = object(raw, "fields");
  if (Object.values(values).some((value) => value === null)) return invalid("Create fields cannot be null; omit optional fields instead.");
  const fields = applyPatch(new Map(), parsePatch(definition, values));
  assertRequired(definition, fields);
  return fields;
};

export const fieldsDocument = (fields: FieldValues): JsonObject => Object.fromEntries(
  [...fields].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, value]) => [name, value.value]),
);
export const patchDocument = (patch: FieldPatch): JsonObject => Object.fromEntries(
  [...patch].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, value]) => [name, value?.value ?? null]),
);
