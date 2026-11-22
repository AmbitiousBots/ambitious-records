import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";
import { failure } from "@ambitious/kit/domain/failure";
import type { JsonObject } from "@ambitious/kit/domain/json";
import schema from "../../schemas/record-type.v1.json" with { type: "json" };
import { TYPE_NAME_HINT, TYPE_NAME_RULE, fieldName, invalid, stageName, typeName, typeVersion } from "./scalars.ts";
import { isCurrencyCode, makeRecordType } from "./types.ts";
import type { Field, FieldDocument, FieldName, NonEmptyArray, RecordType, RecordTypeDocument, StageName, Transition } from "./types.ts";

const validateDocument = new Ajv2020({ allErrors: true, strict: true }).compile<RecordTypeDocument>(schema);

const nonEmpty = <T>(values: readonly T[]): NonEmptyArray<T> => {
  const [first, ...rest] = values;
  if (first === undefined) return invalid("The list must not be empty.");
  return [first, ...rest];
};

const parseField = (document: FieldDocument): Field => {
  const required = document.required ?? false;
  const unique = document.unique ?? false;
  switch (document.kind) {
    case "string": case "int": case "date": case "datetime": return { kind: document.kind, required, unique };
    case "text": case "decimal": case "bool": return { kind: document.kind, required, unique: false };
    case "money": {
      const currency = document.currency;
      if (currency === undefined || !isCurrencyCode(currency)) return invalid("money requires a three-letter currency.");
      return { kind: "money", required, unique: false, currency };
    }
    case "enum": return { kind: "enum", required, unique: false, values: nonEmpty(document.values ?? []) };
    case "ref": return { kind: "ref", required, unique, type: typeName(document.type) };
  }
};

const brokeTypeNameRule = (error: ErrorObject): boolean => error.schemaPath.startsWith("#/$defs/typeName/");

export const parseRecordType = (raw: unknown): RecordType => {
  if (!validateDocument(raw)) {
    const errors = validateDocument.errors ?? [];
    const reasons = errors.map((error) => `${error.instancePath || "/"} ${brokeTypeNameRule(error) ? TYPE_NAME_RULE : error.message}`);
    return invalid(`Invalid record type definition: ${reasons.join("; ") || "schema mismatch"}.`, errors.some(brokeTypeNameRule) ? TYPE_NAME_HINT : undefined);
  }
  const fields = new Map<FieldName, Field>(Object.entries(raw.fields).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, field]) => [fieldName(name), parseField(field)]));
  const stages = nonEmpty(raw.stages.map(stageName));
  const initial = stageName(raw.initial);
  const terminal = new Set(raw.terminal.map(stageName));
  if (!stages.includes(initial)) return invalid("initial must name a declared stage.");
  if ([...terminal].some((stage) => !stages.includes(stage))) return invalid("terminal must contain only declared stages.");
  const seen = new Set<string>();
  const transitions: Transition[] = [];
  for (const declared of raw.transitions) {
    const to = stageName(declared.to);
    const requires = new Set((declared.requires ?? []).map(fieldName));
    if ([...requires].some((field) => !fields.has(field))) return invalid("Transition requirements must name declared fields.");
    for (const source of typeof declared.from === "string" ? [declared.from] : declared.from) {
      const from = stageName(source);
      if (!stages.includes(from) || !stages.includes(to)) return invalid("Transitions must name declared stages.");
      if (terminal.has(from)) return invalid("A terminal stage cannot have an outgoing transition.");
      const pair = `${from}:${to}`;
      if (seen.has(pair)) return invalid("Each transition may be declared only once.");
      seen.add(pair);
      transitions.push({ from, to, requires });
    }
  }
  return makeRecordType({ type: typeName(raw.type), version: typeVersion(raw.version), fields, stages, initial, terminal, transitions });
};

export const typeDocument = (definition: RecordType): JsonObject => ({
  type: definition.type,
  version: definition.version,
  fields: Object.fromEntries([...definition.fields].map(([name, field]) => [name, { ...field }])),
  stages: definition.stages,
  initial: definition.initial,
  transitions: definition.transitions.map(({ from, to, requires }) => ({ from, to, requires: [...requires].sort() })),
  terminal: [...definition.terminal].sort(),
});

const compatibleField = (previous: Field, next: Field): boolean => {
  if (previous.kind !== next.kind || (!previous.required && next.required) || previous.unique !== next.unique) return false;
  if (previous.kind === "money") return next.kind === "money" && previous.currency === next.currency;
  if (previous.kind === "ref") return next.kind === "ref" && previous.type === next.type;
  if (previous.kind === "enum") return next.kind === "enum" && previous.values.every((value) => next.values.includes(value));
  return true;
};

export const assertCompatible = (previous: RecordType, next: RecordType): void => {
  const incompatible = (reason: string): never => {
    throw failure("E_INCOMPATIBLE", reason, "Keep existing fields, constraints, stages and moves compatible; add only optional fields and permitted behavior.");
  };
  if (previous.type !== next.type || next.version <= previous.version) incompatible("A new definition must have the same type and a higher version.");
  if (previous.initial !== next.initial) incompatible("The initial stage cannot change.");
  for (const [name, field] of previous.fields) {
    const candidate = next.fields.get(name);
    if (candidate === undefined || !compatibleField(field, candidate)) incompatible(`Field ${name} is not backward compatible.`);
  }
  for (const [name, field] of next.fields) {
    if (!previous.fields.has(name) && field.required) incompatible(`New field ${name} must be optional.`);
  }
  if (previous.stages.some((stage) => !next.stages.includes(stage))) incompatible("Existing stages cannot be removed.");
  for (const stage of previous.stages) {
    if (previous.terminal.has(stage) !== next.terminal.has(stage)) incompatible("An existing stage's terminal status cannot change.");
  }
  for (const transition of previous.transitions) {
    const candidate = next.transitions.find(({ from, to }) => from === transition.from && to === transition.to);
    if (candidate === undefined || [...candidate.requires].some((field) => !transition.requires.has(field))) incompatible("Existing moves cannot be removed or made more restrictive.");
  }
};

export const hasStage = (definition: RecordType, stage: StageName): boolean => definition.stages.includes(stage);
