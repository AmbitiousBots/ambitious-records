---
name: verify-formal-records
description: "Check the records module's stage machine rules (only declared moves succeed, a terminal stage is final, required fields are present before a move) against the TLA+ model, and the record type schema and presets against their examples. Use when a change touches the move or allowed commands, how a type definition is read, the presets, or any file in spec/, schemas/, presets/ or src/domain/."
---

# Formal verification for the records module

## What is verified

| Rule | In plain words | Harm if it breaks |
|---|---|---|
| `OnlyDeclaredTransitions` | Every move a record makes is a transition its type declares. | A record jumps to a stage it should not reach; the stages stop meaning anything. |
| `TerminalIsFinal` | A record in a terminal stage never moves again, whatever the type declares. | A finished record is reopened and changed. |
| `RequiredFieldsBeforeMove` | At the moment of a move, every field the transition requires has a value. | A record moves on with information missing. |

Tool: TLA+ with the TLC model checker, because the question is whether any type definition and any order of updates and moves can reach a bad state. Tests only try the definitions and orders someone thought of.

Bounds: one record; the four presets in `presets/`, and every type with three stages and one field (157,464 types, including ones that declare a transition out of a terminal stage); no limit on the number of steps. `spec/README.md` lists what is left out.

The same command also checks `schemas/record-type.v1.json`: the presets and valid examples are accepted, every invalid example is rejected for the reason written next to it, the schema agrees with the types in `src/domain/types.ts`, and the model contains the presets exactly as they are in `presets/`.

## The one command

From the repo root:

```sh
npm run release:build && npm run typecheck && npm run check:schemas && npm run tlc && node --test --test-name-pattern='^(move|allowed|replay):' test/cli.test.mjs test/property.test.mjs
```

First install the pinned tools and dependencies with `mise trust -q .`, `mise install -q` and `npm ci`. [mise](https://mise.jdx.dev) provides Node and Java. `npm run tlc` calls `spec/check.sh`, which uses the shared kit runner and the repository's model checks. The runner downloads `tla2tools.jar` from the address pinned in `.mise.toml` and refuses it unless its SHA-256 matches the pin. The main model must pass and every variant in `spec/broken/` must break the rule named in `spec/broken/EXPECTED.json`. A successful shared-runner summary starts with `tlc: ok.`. `npm run check:schemas` ends with `check:schemas: ok`.

## Covered code

The model, domain schema and implementation mapping were verified at commit `31cd974710c48bc15970ce3c1e566468008e00db`. The mapping below must be checked whenever its covered files change. Advance the sync commit only after reviewing the mapping and running the command above against that commit.

| Model part | Code it describes |
|---|---|
| `Types`, and the record `stages`, `initial`, `terminal`, `fields`, `transitions` | `RecordType` and `Transition` in `src/domain/types.ts`; the definitions stored by `type define` |
| `Invoice`, `Booking`, `InventoryItem`, `Case` | `presets/*.json` |
| `Closed` | `parseRecordType` in `src/domain/definition.ts` checks declared stages and fields and rejects outgoing transitions from terminal stages |
| start state | `createRecord` in `src/db/store.ts` assigns the type's initial stage |
| `Update` | `updateRecord` in `src/db/store.ts` applies field patches without changing the stage |
| `Move`, `Declared`, `Required` | `decideMove` in `src/domain/records.ts` checks terminal status, declared transition and field presence; `moveOrThrow` reports refusals |
| `lastMove` | `moveRecord` and `appendEvent` in `src/db/store.ts` update the stage and append a `moved` event in the command transaction |
| `schemas/record-type.v1.json` | `RecordTypeDocument`, `FIELD_KINDS`, `UNIQUE_FIELD_KINDS`, `NAME_PATTERNS`, `DEFINITION_RULES` |

Run `git log 31cd974710c48bc15970ce3c1e566468008e00db..HEAD -- src/domain src/db spec schemas presets scripts`. If it lists commits, read them against the table before you trust a pass. Move the commit above forward only after you have confirmed that every row still describes the code at the new commit.

One `Move` step in the model is one transaction in the code: read the record, decide, write the new stage and the event. The shared kit runs write handlers transactionally; `src/cli/main.ts` declares `move` as a write command. If `move` is ever split across transactions, or another command starts to change a record's stage, the model no longer describes the code; model that before relying on a pass.

## Reading a result

If your agent setup has a `/statechart` skill for TLA+ models (pstack, a public plugin of agent skills, has one: it runs the checker, reports each broken rule as its shortest path in plain words, and draws the states as a chart when the model passes), read every result with it. Refer to it by name; do not copy its commands here. Without it, read TLC's output directly as follows.

When a check fails, `spec/check.sh` prints TLC's full output. Find the line `Error: Invariant <Rule> is violated.`; the rule it names is the one that broke. Below it TLC prints the shortest path to the bad state as numbered states:

```text
Error: Invariant OnlyDeclaredTransitions is violated.
Error: The behavior up to this point is:
State 1: <Initial predicate>
/\ lastMove = {}
/\ type = [ stages |-> {"s1", "s2", "s3"},
  initial |-> "s1",
  terminal |-> {},
  fields |-> {"f1"},
  transitions |-> {} ]
/\ present = {}
/\ stage = "s1"

State 2: <Next line 122, col 6 to line 122, col 37 of module MoveWithoutLookup>
/\ lastMove = {[from |-> "s1", to |-> "s1", had |-> {}]}
/\ type = [ stages |-> {"s1", "s2", "s3"},
  initial |-> "s1",
  terminal |-> {},
  fields |-> {"f1"},
  transitions |-> {} ]
/\ present = {}
/\ stage = "s1"
```

Each state lists every variable after one step. Read down the list and compare each state with the one before; what changed is what the step did. The last state breaks the rule. Write the path as one line per step before deciding anything. Here: a record is created of a type that declares no transitions; it moves from `s1` to `s1` anyway.

To tell a path in the module's words:

- `type` is the record's type definition, as declared. It never changes. Read `transitions` and `terminal` first: they say what the type allows.
- `stage` is the record's current stage.
- `present` is the set of fields that have a value. A step that changes only `present` is an `update`.
- `lastMove` is the most recent successful `move`: `from` and `to`, and `had`, the fields that had a value at that moment. A step that changes `stage` or `lastMove` is a `move`.

Types named `s1`, `s2`, `s3` with field `f1` are the small made-up types. A path through one of them is still a real path: write the same definition as a JSON document and replay it.

To run one model by hand with the checksum-verified jar, from the repo root:

```sh
tla_jar=$(node scripts/tla2tools.mjs)
mise exec -- java -cp "$tla_jar" tlc2.TLC -workers 1 -metadir "$(mktemp -d)" -noGenerateSpecTE -config spec/broken/MoveWithoutLookup.cfg spec/broken/MoveWithoutLookup.tla
```

When the model passes, the table reports the number of distinct states TLC checked. The repository's wrapper fails if that number is too small for the model to be exploring anything.

A `FAIL:` line from `npm run check:schemas` names the file and what to fix.

## Real bug or modeling error

1. Replay the path against the real code, one command per step, as a test: `type define` with the type from the path, `create`, then each `update` and `move`. If the code does the same, it is a real bug: report it with the path. Do not weaken the rule, and do not change product code unless asked.
2. If the code cannot take one of the steps, the model allows something the code forbids. Find the guard in the code, add it to the model, and say so in the pull request.
3. If a broken variant stops failing, or breaks a different rule, the model changed so that the rule can no longer catch that mistake. Treat that as a failure of the model.

## Changing things on purpose

- Change `spec/StageMachine.tla` first, then make the same change in each file in `spec/broken/`, keeping only its one changed line. `check.sh` fails if a variant drifts further from the model or uses another configuration.
- A new rule needs a new broken variant that breaks it, an entry in `spec/broken/EXPECTED.json` and a row in `spec/README.md`. `check.sh` fails if a rule has no variant.
- After changing a preset, run `npm run check:schemas`. It prints the text the model must contain; put it in `spec/StageMachine.tla` and in every file in `spec/broken/`, then run `bash spec/check.sh`.
- After changing the schema, add or adjust examples in `schemas/examples/` and their entries in `schemas/examples/EXPECTED.json`. A change that makes a valid definition invalid belongs in a new schema file with a new version number.
- A new field kind or a new definition rule goes in `src/domain/types.ts` and in the schema or `scripts/check-schemas.mjs` together; the check fails when they disagree.
- To move to another TLC build, change `TLA2TOOLS_URL` and `TLA2TOOLS_SHA256` in `.mise.toml` together.
- Run the one command, then update the commit in "Covered code".
