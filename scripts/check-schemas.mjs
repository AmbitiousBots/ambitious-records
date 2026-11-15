#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  DEFINITION_RULES,
  FIELD_KINDS,
  NAME_LIMIT,
  NAME_PATTERNS,
  UNIQUE_FIELD_KINDS,
} from "../src/domain/types.ts";

const repoRoot = join(import.meta.dirname, "..");
const schemaFile = join(repoRoot, "schemas", "record-type.v1.json");
const exampleDirectory = join(repoRoot, "schemas", "examples");
const presetDirectory = join(repoRoot, "presets");
const modelFile = join(repoRoot, "spec", "StageMachine.tla");

const PRESETS = ["invoice", "booking", "inventory-item", "case"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const jsonFiles = (directory) =>
  existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .sort()
    : [];
const sameMembers = (left, right) => left.length === right.length && [...left].sort().join("\n") === [...right].sort().join("\n");

const eachTransition = (document) =>
  document.transitions.flatMap((transition, index) =>
    [transition.from].flat().map((from) => ({ index, from, to: transition.to, requires: transition.requires ?? [] })),
  );

const RULES = {
  "initial-is-a-stage": (document) => !document.stages.includes(document.initial),
  "terminal-are-stages": (document) => document.terminal.some((stage) => !document.stages.includes(stage)),
  "transition-stages-are-stages": (document) =>
    eachTransition(document).some(({ from, to }) => !document.stages.includes(from) || !document.stages.includes(to)),
  "required-fields-are-fields": (document) =>
    eachTransition(document).some(({ requires }) => requires.some((field) => !Object.hasOwn(document.fields, field))),
  "no-transition-out-of-terminal": (document) =>
    eachTransition(document).some(({ from }) => document.terminal.includes(from)),
  "transition-declared-once": (document) => {
    const pairs = eachTransition(document).map(({ from, to }) => `${from} ${to}`);
    return new Set(pairs).size !== pairs.length;
  },
};

const brokenRules = (document) => Object.keys(RULES).filter((rule) => RULES[rule](document));

const schemaErrors = (validate) => validate.errors.map((e) => `"${e.keyword}" at "${e.instancePath}"`).join(", ");

const checkSchemaMatchesTypes = (schema) => {
  const problems = [];
  const expectEqual = (what, inSchema, inTypes) => {
    if (JSON.stringify(inSchema) !== JSON.stringify(inTypes)) {
      problems.push(
        `${what}: the schema says ${JSON.stringify(inSchema)} and src/domain/types.ts says ${JSON.stringify(inTypes)}. Change both together`,
      );
    }
  };
  const field = schema.$defs.field;
  expectEqual("field kinds", field.properties.kind.enum, FIELD_KINDS);
  expectEqual(
    "kinds that cannot be unique",
    field.allOf.at(-1).if.properties.kind.enum,
    FIELD_KINDS.filter((kind) => !UNIQUE_FIELD_KINDS.includes(kind)),
  );
  for (const name of ["typeName", "fieldName", "stageName"]) {
    expectEqual(`pattern of ${name}`, schema.$defs[name].pattern, NAME_PATTERNS[name].source);
    expectEqual(`longest ${name}`, schema.$defs[name].maxLength, NAME_LIMIT);
  }
  expectEqual("pattern of a currency code", field.properties.currency.pattern, NAME_PATTERNS.currencyCode.source);
  expectEqual("rules checked next to the schema", Object.keys(RULES), DEFINITION_RULES);
  return problems;
};

const checkPresets = (validate) => {
  const problems = [];
  if (!sameMembers(jsonFiles(presetDirectory), PRESETS.map((name) => `${name}.json`))) {
    problems.push(`presets/ must hold exactly ${PRESETS.map((name) => `${name}.json`).join(", ")}`);
  }
  for (const name of PRESETS) {
    const path = join(presetDirectory, `${name}.json`);
    if (!existsSync(path)) continue;
    const document = readJson(path);
    if (!validate(document)) {
      problems.push(`presets/${name}.json: the schema rejects it by ${schemaErrors(validate)}`);
      continue;
    }
    if (document.type !== name) problems.push(`presets/${name}.json: its type is "${document.type}"; name the file after the type`);
    for (const rule of brokenRules(document)) problems.push(`presets/${name}.json: breaks the rule ${rule}`);
  }
  return problems;
};

const checkExamples = (validate) => {
  const problems = [];
  const valid = jsonFiles(join(exampleDirectory, "valid"));
  const invalid = jsonFiles(join(exampleDirectory, "invalid"));
  const expected = readJson(join(exampleDirectory, "EXPECTED.json"));
  if (valid.length === 0) problems.push("schemas/examples/valid has no examples");
  for (const name of valid) {
    const document = readJson(join(exampleDirectory, "valid", name));
    if (!validate(document)) problems.push(`valid/${name}: must be accepted, but the schema rejects it by ${schemaErrors(validate)}`);
    else if (brokenRules(document).length > 0) problems.push(`valid/${name}: must be accepted, but breaks ${brokenRules(document).join(", ")}`);
  }
  for (const name of Object.keys(expected)) {
    if (!invalid.includes(name)) problems.push(`EXPECTED.json lists ${name}, but schemas/examples/invalid has no such file`);
  }
  for (const name of invalid) {
    const want = expected[name];
    const document = readJson(join(exampleDirectory, "invalid", name));
    const accepted = validate(document);
    if (want === undefined) {
      problems.push(`invalid/${name}: add it to schemas/examples/EXPECTED.json with what must reject it`);
    } else if (typeof want.rule === "string") {
      if (!accepted) {
        problems.push(`invalid/${name}: must pass the schema and break only the rule ${want.rule}, but the schema rejects it by ${schemaErrors(validate)}`);
      } else if (!sameMembers(brokenRules(document), [want.rule])) {
        problems.push(`invalid/${name}: must break only the rule ${want.rule}, but breaks ${brokenRules(document).join(", ") || "nothing"}`);
      }
    } else if (typeof want.keyword === "string" && typeof want.at === "string") {
      if (accepted) {
        problems.push(`invalid/${name}: must be rejected, but the schema accepts it`);
      } else if (!validate.errors.some((e) => e.keyword === want.keyword && e.instancePath === want.at)) {
        problems.push(`invalid/${name}: rejected, but not by "${want.keyword}" at "${want.at}" as EXPECTED.json says. It was rejected by ${schemaErrors(validate)}`);
      }
    } else {
      problems.push(`invalid/${name}: its EXPECTED.json entry must be { "keyword", "at" } for a schema rejection or { "rule" } for a rule`);
    }
  }
  for (const rule of DEFINITION_RULES) {
    if (!Object.values(expected).some((want) => want.rule === rule)) {
      problems.push(`no invalid example breaks the rule ${rule}, so nothing shows the check can catch it`);
    }
  }
  return { problems, valid: valid.length, invalid: invalid.length };
};

const tlaName = (typeName) =>
  typeName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

const tlaSet = (names) => `{${names.map((name) => `"${name}"`).join(", ")}}`;

const tlaDefinition = (document) => {
  const transitions = eachTransition(document).map(
    ({ from, to, requires }) => `      [from |-> "${from}", to |-> "${to}", requires |-> ${tlaSet(requires)}]`,
  );
  return [
    `${tlaName(document.type)} ==`,
    `  [ stages |-> ${tlaSet(document.stages)},`,
    `    initial |-> "${document.initial}",`,
    `    terminal |-> ${tlaSet(document.terminal)},`,
    `    fields |-> ${tlaSet(Object.keys(document.fields))},`,
    `    transitions |-> {`,
    `${transitions.join(",\n")} } ]`,
  ].join("\n");
};

const checkModelUsesPresets = () => {
  const model = readFileSync(modelFile, "utf8");
  const documents = PRESETS.map((name) => join(presetDirectory, `${name}.json`))
    .filter(existsSync)
    .map(readJson);
  const wanted = [...documents.map(tlaDefinition), `PresetTypes == {${documents.map((d) => tlaName(d.type)).join(", ")}}`];
  return wanted
    .filter((text) => !model.includes(`\n${text}\n`))
    .map((text) => `spec/StageMachine.tla does not check the presets as they are in presets/. Make it (and every copy in spec/broken/) contain exactly:\n${text}`);
};

const schema = readJson(schemaFile);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const examples = checkExamples(validate);
const problems = [...checkSchemaMatchesTypes(schema), ...checkPresets(validate), ...examples.problems, ...checkModelUsesPresets()];

for (const problem of problems) process.stdout.write(`FAIL: ${problem}\n`);
if (problems.length > 0) {
  process.stdout.write(`check:schemas: ${problems.length} problem(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    [
      `schemas/record-type.v1.json agrees with src/domain/types.ts on field kinds, names and rules`,
      `${PRESETS.length} presets accepted: ${PRESETS.join(", ")}`,
      `${examples.valid} valid examples accepted, ${examples.invalid} invalid examples rejected for the listed reason`,
      `spec/StageMachine.tla checks the ${PRESETS.length} presets as they are in presets/`,
      `check:schemas: ok`,
      ``,
    ].join("\n"),
  );
}
