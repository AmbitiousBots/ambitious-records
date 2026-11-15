import { readCommand, writeCommand } from "@ambitious/kit/cli/command";
import { embedded } from "@ambitious/kit/cli/embedded";
import { runCli } from "@ambitious/kit/cli/run-cli";
import { getType } from "../db/rows.ts";
import { allowed, createRecord, defineType, history, listTypes, moveRecord, recordsOfType, updateRecord } from "../db/store.ts";
import { parseRecordType, typeDocument } from "../domain/definition.ts";
import { parseCreate, parseId, parseMove, parseQuery, parseTypeGet, parseUpdate } from "../domain/input.ts";
import { queryRecords } from "../domain/query.ts";
import { recordDocument } from "../domain/records.ts";

await runCli({
  ...embedded(),
  schemaVersion: 1,
  commands: {
    "type define": writeCommand({ input: parseRecordType, run: ({ db, input }) => defineType(db, input) }),
    "type list": readCommand({ run: ({ db }) => listTypes(db) }),
    "type get": readCommand({ input: parseTypeGet, run: ({ db, input }) => ({ definition: typeDocument(getType(db, input.type, input.version)) }) }),
    create: writeCommand({ input: parseCreate, run: ({ db, input, clock }) => createRecord(db, input, clock) }),
    update: writeCommand({ input: parseUpdate, run: ({ db, input, clock }) => updateRecord(db, input, clock) }),
    move: writeCommand({ input: parseMove, run: ({ db, input, clock }) => moveRecord(db, input, clock) }),
    allowed: readCommand({ input: parseId, run: ({ db, input }) => allowed(db, input.id) }),
    query: readCommand({ input: parseQuery, run: ({ db, input }) => ({ records: queryRecords(getType(db, input.type), recordsOfType(db, input.type), input).map(recordDocument) }) }),
    history: readCommand({ input: parseId, run: ({ db, input }) => history(db, input.id) }),
  },
});
