import { parseFieldValue } from "./fields.ts";
import type { Query, QueryFilter } from "./input.ts";
import { invalid } from "./scalars.ts";
import type { DecimalText, Field, FieldName, FieldValue, RecordType, StoredRecord } from "./types.ts";

const compareDecimal = (left: DecimalText, right: DecimalText): number => {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const a = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const b = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
  return a < b ? -1 : a > b ? 1 : 0;
};

const compareValue = (left: FieldValue, right: FieldValue): number => {
  if ((left.kind === "decimal" || left.kind === "money") && (right.kind === "decimal" || right.kind === "money")) {
    return compareDecimal(left.value, right.value);
  }
  return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
};

const getField = (definition: RecordType, name: FieldName): Field => {
  const field = definition.fields.get(name);
  if (field === undefined) return invalid(`Unknown field ${name}.`);
  return field;
};

const matchesFilter = (definition: RecordType, filter: QueryFilter): ((record: StoredRecord) => boolean) => {
  const field = getField(definition, filter.field);
  const value = filter.value;
  if (filter.op === "exists") {
    if (typeof value !== "boolean") return invalid("exists requires a boolean value.");
    return (record) => record.fields.has(filter.field) === value;
  }
  if (filter.op === "contains") {
    if ((field.kind !== "string" && field.kind !== "text") || typeof value !== "string") return invalid("contains requires a string or text field and a string value.");
    return (record) => {
      const actual = record.fields.get(filter.field);
      return actual !== undefined && typeof actual.value === "string" && actual.value.includes(value);
    };
  }
  if (filter.op === "in") {
    if (!Array.isArray(value)) return invalid("in requires a list of field values.");
    const expected = value.map((item) => item === null ? undefined : parseFieldValue(field, item));
    return (record) => {
      const actual = record.fields.get(filter.field);
      return expected.some((item) => actual === undefined || item === undefined ? actual === item : compareValue(actual, item) === 0);
    };
  }
  if (value === null) {
    if (filter.op !== "eq" && filter.op !== "ne") return invalid("Only eq and ne accept null; use exists to test field presence.");
    return (record) => record.fields.has(filter.field) === (filter.op === "ne");
  }
  const expected = parseFieldValue(field, value);
  return (record) => {
    const actual = record.fields.get(filter.field);
    if (actual === undefined) return false;
    const order = compareValue(actual, expected);
    switch (filter.op) {
      case "eq": return order === 0;
      case "ne": return order !== 0;
      case "gt": return order > 0;
      case "gte": return order >= 0;
      case "lt": return order < 0;
      case "lte": return order <= 0;
      default: return false;
    }
  };
};

export const queryRecords = (definition: RecordType, records: readonly StoredRecord[], query: Query): readonly StoredRecord[] => {
  if (query.stage !== undefined && !definition.stages.includes(query.stage)) return invalid("stage must name a declared stage.");
  const filters = query.where.map((filter) => matchesFilter(definition, filter));
  for (const order of query.order) getField(definition, order.field);
  return records.filter((record) => (query.stage === undefined || record.stage === query.stage) && filters.every((matches) => matches(record)))
    .sort((left, right) => {
      for (const order of query.order) {
        const a = left.fields.get(order.field);
        const b = right.fields.get(order.field);
        if (a === undefined && b === undefined) continue;
        if (a === undefined) return 1;
        if (b === undefined) return -1;
        const comparison = compareValue(a, b);
        if (comparison !== 0) return order.direction === "asc" ? comparison : -comparison;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    }).slice(0, query.limit);
};
