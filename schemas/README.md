# Schemas

`record-type.v1.json` is the JSON Schema (draft 2020-12) for a record type definition: the document the `type define` command reads. The files in `presets/` are four such documents.

```json
{ "type": "invoice", "version": 1,
  "fields": { "number": { "kind": "string", "required": true, "unique": true },
              "amount": { "kind": "money", "currency": "USD", "required": true },
              "due": { "kind": "date" }, "customer": { "kind": "string" } },
  "stages": ["draft", "sent", "paid", "void"], "initial": "draft",
  "transitions": [{ "from": "draft", "to": "sent", "requires": ["number", "amount"] },
                  { "from": "sent", "to": "paid" },
                  { "from": ["draft", "sent"], "to": "void" }],
  "terminal": ["paid", "void"] }
```

## What the schema says

- **Names.** A type name is lower-case words joined by hyphens (`inventory-item`). Field and stage names are lower-case words joined by underscores (`unit_cost`, `in_progress`). Each is at most 64 characters.
- **Field kinds.** `string`, `text`, `int`, `decimal`, `money`, `date`, `datetime`, `bool`, `enum` and `ref`. A `money` field must name its `currency` (three capital letters). An `enum` field must list its `values`. A `ref` field must name the record `type` it points to. These three options are rejected on any other kind.
- **`required` and `unique`** are optional and default to false. `unique` is allowed only on `string`, `int`, `date`, `datetime` and `ref`: kinds whose values have exactly one written form, so "the same value" has one meaning. Allowing more kinds later accepts more documents and breaks none.
- **Stages.** At least one, no repeats.
- **Transitions.** `from` is one stage or a non-empty list of stages; a list means the same move from each of them. `requires` is optional.
- **`terminal`** must be present, and may be empty.
- **No unknown properties** anywhere, and every list and name has a maximum size.

## What the schema cannot say

JSON Schema cannot compare one part of a document with another. These rules are checked next to the schema, by `npm run check:schemas` for the presets and examples here, and by the module when it reads a definition (`ParseRecordType` and `DefinitionProblem` in `src/domain/types.ts`):

| Rule | In plain words |
|---|---|
| `initial-is-a-stage` | `initial` is one of `stages`. |
| `terminal-are-stages` | Every entry of `terminal` is one of `stages`. |
| `transition-stages-are-stages` | Every `from` and `to` is one of `stages`. |
| `required-fields-are-fields` | Every name in `requires` is one of `fields`. |
| `no-transition-out-of-terminal` | No transition starts from a terminal stage. Such a definition contradicts itself. |
| `transition-declared-once` | No two transitions cover the same `from` and `to`, so the fields a move requires are stated in one place. |

## Examples

`examples/valid/` holds documents that must be accepted. `examples/invalid/` holds documents that must be rejected, and `examples/EXPECTED.json` says by what, so an example cannot pass the check by being wrong in some other way:

- `{ "keyword": "...", "at": "..." }`: the schema rejects it with that keyword at that place in the document.
- `{ "rule": "..." }`: the schema accepts it, and it breaks that one rule from the table above and no other.

## The check

```sh
npm ci && npm run check:schemas
```

It fails unless all of these hold:

- The schema compiles in the validator's strict mode.
- The schema and `src/domain/types.ts` agree on the field kinds, the kinds that can be unique, the name patterns and the list of rules.
- `presets/` holds exactly `invoice.json`, `booking.json`, `inventory-item.json` and `case.json`; each is accepted, breaks no rule, and is named after its type.
- Every valid example is accepted, every invalid example is rejected for the listed reason, and every rule has an invalid example that breaks it.
- The model in `spec/StageMachine.tla` contains the four presets exactly as they are in `presets/`. When a preset changes, the failure message prints the text to put in the model.

Presets are data. Nothing in the module's code may depend on a preset's name or contents.
