# Formal model of the stage machine

A record type declares its stages and the moves between them as data (see `schemas/record-type.v1.json` and `presets/`). The `move` command must refuse every move the type does not declare. This folder holds a small model of that rule and checks it for every order of steps, for the four presets and for every small type. It was written before the `move` code, so the code is written against rules that are already checked.

Run it from the repo root:

```sh
bash spec/check.sh
```

The script needs [mise](https://mise.jdx.dev) (it installs the pinned Java), `curl` and Node. It downloads TLC, the model checker for the TLA+ language, as `tla2tools.jar` (version 1.8.0) from the address pinned in `.mise.toml`, keeps it in `~/.cache/ambitious/` and refuses a file whose SHA-256 differs from the pin. A run takes about a minute.

## `StageMachine.tla`: the model

The model follows one record of one type. It takes the set of types to check as its parameter, `Types`. Each type is its declared data: `stages`, `initial`, `terminal`, `fields` and `transitions`, where a transition is `from`, `to` and the fields it `requires`.

| Step in the model | What it stands for |
|---|---|
| start | `create`: a new record in the type's `initial` stage, with any of its fields filled in or empty. |
| `Update` | `update`: a field gets a value or loses it. |
| `Move` | `move`: the record goes to another stage. Allowed only when the record is not in a terminal stage, the type declares a transition from the current stage to the target, and every field that transition requires has a value. |

`lastMove` remembers the most recent successful move: where it started, where it ended, and which fields had a value at that moment. The rules are written about it, so they are checked after every move the model can make.

The rules, checked in every reachable state (about 1,100,000 distinct states):

| Rule | In plain words | Harm if it breaks |
|---|---|---|
| `OnlyDeclaredTransitions` | Every move a record makes is a transition its type declares. | An invoice goes from draft straight to paid; the stages stop meaning anything. |
| `TerminalIsFinal` | A record in a terminal stage never moves again, whatever the type declares. | A paid or void record is reopened and changed after everyone treated it as finished. |
| `RequiredFieldsBeforeMove` | At the moment of a move, every field the transition requires has a value. | An invoice is sent with no number or no amount. |

`TypeOK` is also checked: every value stays in its allowed set.

### Which types are checked

`StageMachine.cfg` sets `Types` to `CheckedTypes`, which is two groups:

- **The four presets**: `Invoice`, `Booking`, `InventoryItem` and `Case`, written in the model exactly as they are in `presets/*.json` (a transition with a list in `from` becomes one transition per stage). `npm run check:schemas` fails when the model and the preset files differ, so the model cannot drift from the data.
- **Every small type** (`EverySmallType`): every type with three stages and one field. For each ordered pair of stages, including a stage and itself, the transition is either not declared, declared, or declared with the field required; any set of stages may be terminal. That is 157,464 types. They include types no preset resembles, and types that contradict themselves by declaring a transition out of a terminal stage. The start stage is always `s1`; the three stages are interchangeable, so a type that starts elsewhere is one of these with the names swapped.

The second group is why a pass means more than "the presets work": the rules hold for whatever a type declares, up to that size.

The model tracks only fields that some transition requires. Other fields cannot affect a move.

## `broken/`: showing that each rule can fail

Each file in `spec/broken/` is the model with one line of `Move` changed to a plausible mistake. `check.sh` requires each to break the rule listed for it in `broken/EXPECTED.json` and no other rule first, to use the same configuration as the model, and to differ from the model in at most two lines. It also requires every rule in `StageMachine.cfg` to have a variant that breaks it.

| Variant | The mistake | Rule it must break |
|---|---|---|
| `MoveWithoutLookup` | `move` accepts any stage of the type as the target without looking the move up in the declared transitions. | `OnlyDeclaredTransitions` |
| `MoveIgnoresTerminal` | `move` does not refuse a record in a terminal stage, and relies on the type declaring no way out. | `TerminalIsFinal` |
| `MoveSkipsRequiredFields` | `move` does not check the fields the transition requires. | `RequiredFieldsBeforeMove` |

`MoveIgnoresTerminal` passes on the four presets alone, because none of them declares a transition out of a terminal stage. It is caught by the small types that do. A stored type definition is data, and data can be wrong, so `move` checks the terminal stage itself.

`EXPECTED.json` has one entry per variant: `{ "<variant>": { "invariant": "<rule>", "because": "<plain sentence>" } }`. This is the shape the shared TLC runner in [ambitious-kit](https://github.com/AmbitiousBots/ambitious-kit) reads, and each variant sits next to a `.cfg` of the same name as that runner expects, so it can replace `check.sh` without changes here.

## Which code this constrains

The module's commands do not exist yet. When they are written:

| Code | Constrained by |
|---|---|
| `DecideMove` in `src/domain/types.ts`: whether a move is allowed, and why not | all three rules |
| `AllowedMoves`: the next stages and the fields still missing for each | must agree with `DecideMove`: a stage is offered with nothing missing exactly when the move would succeed |
| `ParseRecordType`: turning a type definition into a `RecordType` | the model's assumption `Closed`: `initial`, `terminal` and every transition name only declared stages, and `requires` only declared fields |
| the `move` command: reads the record, decides, writes the new stage and a `moved` event | one `Move` step; it must be one database transaction |

## What is not covered

- The model checks the design, not the TypeScript. Tests must tie the code to it: a property test that drives `DecideMove` with generated types, field values and move orders and checks the same three rules.
- Types larger than three stages and one field are checked only through the four presets.
- A new version of a type. A record keeps the version it was created with; whether a later version may change which stages are terminal, and what happens to records then, is for the `type define` compatibility check and is not modeled.
- Field values. The model knows only whether a field has a value. Kinds, `required` on a field and `unique` are not modeled.
- Several records, idempotency keys and replay of the event log are not modeled. Records do not affect each other's stages.
- Crashes in the middle of a write are not modeled; each step is one transaction.
