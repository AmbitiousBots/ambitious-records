# ambitious-records

Ambitious Records is a command-line tool for typed records. Define fields, stages and transitions as JSON, then create, update and query records in one SQLite database. A record can move only along a declared transition, after every field required for that transition has a value. Terminal stages cannot move again.

It is part of [Ambitious](https://ambitiousbots.com), a bot configuration and monitoring service. The module runs locally with Node 24, needs no API key and makes no network calls. It follows [the module contract](MODULE_CONTRACT.md).

## Build and try it

Install [mise](https://mise.jdx.dev), which manages the pinned Node and Java runtimes, then run:

```sh
mise trust -q .
mise install -q
npm ci
npm run build
export AMBITIOUS_HOME="$(mktemp -d)"
node dist/ambitious-records.mjs selfcheck --now 2026-01-01T00:00:00Z --seed 7
```

Define a type:

```sh
node dist/ambitious-records.mjs type define <<'JSON'
{
  "type": "entry",
  "version": 1,
  "fields": {
    "label": { "kind": "string", "required": true, "unique": true },
    "score": { "kind": "int" }
  },
  "stages": ["draft", "ready", "done"],
  "initial": "draft",
  "transitions": [
    { "from": "draft", "to": "ready", "requires": ["score"] },
    { "from": "ready", "to": "done" }
  ],
  "terminal": ["done"]
}
JSON
```

Create a record and keep the returned identifier:

```sh
created=$(printf '%s' '{"type":"entry","fields":{"label":"First","score":0},"idem_key":"create-first"}' |
  node dist/ambitious-records.mjs create --now 2026-01-01T00:00:00Z --seed 7)
printf '%s\n' "$created"
record_id=$(printf '%s' "$created" | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).data.record.id')
printf '{"id":"%s"}' "$record_id" | node dist/ambitious-records.mjs allowed
printf '{"id":"%s","to":"ready","idem_key":"move-first"}' "$record_id" |
  node dist/ambitious-records.mjs move
printf '%s' '{"type":"entry","stage":"ready"}' | node dist/ambitious-records.mjs query
printf '{"id":"%s"}' "$record_id" | node dist/ambitious-records.mjs history
```

The database is at `$AMBITIOUS_HOME/records/records.sqlite`. Use `--db file` to select another database. If `AMBITIOUS_HOME` is absent, it defaults to `/workspace/ambitious`, the module data directory on a Grok Bot computer. The module refuses `/home/box/agent-data`, the bot's private data directory, including paths that resolve there through symbolic links.

## Command interface

Pass JSON on stdin or with `--in file`. `--in` accepts a file path, not inline JSON. All commands accept `--db`, `--now`, `--seed` and `--json`. Output is always one JSON envelope with `ok`, `schemaVersion`, `module`, `command`, `data`, `errors` and `meta`. Exit status is 0 for success, 1 for a caller error and 2 for an internal or database error. `meta` reports the timestamp, seed and binary version.

| Command | Input | Successful `data` | Database access |
|---|---|---|---|
| `commands` | None | `{ commands: [{ name, access, input }] }` | None |
| `selfcheck` | None | Runtime, binary checksum, database integrity, schema version and `problems` | Write, to apply pending migrations |
| `type define` | A type definition | `{ type, version }` | Write |
| `type list` | None | `{ types: [definition] }`, all versions | Read |
| `type get` | `{ type, version? }` | `{ definition }`, latest unless a version is given | Read |
| `create` | `{ type, fields, idem_key, actor? }` | `{ record }` in the initial stage | Write |
| `update` | `{ id, fields, idem_key, actor? }` | `{ record }` | Write |
| `move` | `{ id, to, idem_key, actor? }` | `{ record }` | Write |
| `allowed` | `{ id }` | `{ allowed: [{ to, missing }] }` | Read |
| `query` | `{ type, stage?, where?, order?, limit? }` | `{ records }` | Read |
| `history` | `{ id }` | `{ events }` in sequence order | Read |

Read commands open an existing database read-only. Run `selfcheck` first for a fresh database or after installing a binary with a newer database schema. It reports problems in `data.problems` and applies pending migrations. It does not repair a damaged database.

### Fields and type versions

The type document follows [record-type.v1.json](schemas/record-type.v1.json). [Schema documentation](schemas/README.md) explains the definition rules. A type name is lower-case words joined by hyphens (`inventory-item`, not `inventory_item`); field and stage names are lower-case words joined by underscores. The four files in `presets/` are optional starting definitions; all record types use the same code paths.

| Kind | JSON value |
|---|---|
| `string`, `text` | A string |
| `int` | A safe integer |
| `decimal`, `money` | An exact decimal string, such as `"12.50"`; trailing fractional zeroes are normalized |
| `date` | A valid `YYYY-MM-DD` date |
| `datetime` | An ISO timestamp with seconds and a time zone, normalized to UTC milliseconds |
| `bool` | `true` or `false` |
| `enum` | One of the definition's `values` |
| `ref` | The ID of an existing record of the declared type |

A money field's definition fixes its currency. Values are decimal strings, not floating-point numbers or objects. A required field needs a value; empty or whitespace-only strings do not count. Zero and false do count. `update` leaves omitted fields unchanged and removes a field when its patch value is `null`. It refuses removal of required fields. `create` requires optional fields to be omitted instead of set to `null`.

Uniqueness is per type and field across all type versions. It is supported for `string`, `int`, `date`, `datetime` and `ref` fields. Updating or removing a unique field releases its old value. Reference values must name an existing record of the specified type.

Definitions are immutable per version. Repeating the same normalized definition succeeds. A new version must be higher and compatible with the previous version. It may add optional fields, enum values, stages and moves, or relax field and transition requirements. It must retain existing fields, their kinds and uniqueness, money currencies, reference types, the initial stage, existing stages and their terminal status, and every existing transition. Existing records keep the type version used at creation.

### Moves and retries

`allowed` lists declared next stages and the required fields still missing for each. A terminal stage returns an empty list. A rejected move returns `E_TRANSITION`, `data.allowed` as a list of stage names and `data.missing` as the missing field names. A declared move may still need a field update before it can succeed.

`create`, `update` and `move` each require an `idem_key`. Keys are unique across all records and those commands in the database. Retrying the same parsed request returns its original result, even after later changes to the record, without another event. Changing the request while reusing its key returns `E_IDEMPOTENCY`. Use a new key for every intended new mutation. An optional `actor` is recorded in history and defaults to `bot`.

Each mutation commits the record, unique values and history event in one transaction. Failed mutations leave these unchanged. `history` includes the creation, field patches and moves needed to reconstruct the record. A patch value of `null` means removal.

### Queries

Filters in `where` are combined with AND. Each filter has `{ "field", "op", "value" }`. Supported operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains` and `exists`. Values use the field's JSON representation. `in` takes a list; `contains` takes a string for a `string` or `text` field; `exists` takes a boolean. `eq` with `null` matches an absent field, and `ne` with `null` matches a present field. Other comparisons, including `ne` with a non-null value, exclude absent fields.

`order` is a list of `{ "field", "direction" }` entries, with `direction` defaulting to `asc`. Missing values sort last for either direction. Record IDs break ties, so results are stable. Decimal and money comparisons are exact numeric comparisons. `limit` defaults to 100 and accepts integers from 1 through 1000.

```json
{
  "type": "entry",
  "stage": "ready",
  "where": [{ "field": "score", "op": "gte", "value": 0 }],
  "order": [{ "field": "score", "direction": "desc" }],
  "limit": 20
}
```

### Module error codes

Shared errors and their exit codes are documented in [MODULE_CONTRACT.md](MODULE_CONTRACT.md).

| Code | Exit | Meaning | Typical hint |
|---|---|---|---|
| `E_NOT_FOUND` | 1 | A record, type or type version does not exist. | Use an existing ID or define the type first. |
| `E_UNIQUE` | 1 | Another record holds a unique field value. | Choose an unused value. |
| `E_IDEMPOTENCY` | 1 | A key was reused with a different request. | Retry the original request or use a new key. |
| `E_TRANSITION` | 1 | The move is undeclared, terminal or missing required fields. | Read `allowed`, update missing fields or choose another stage. |
| `E_INCOMPATIBLE` | 1 | A type version changes an existing definition incompatibly. | Retain existing behavior and add a compatible version. |

## Verify and release

```sh
npm run release:check
verify/run
npm outdated
npm audit
```

`release:check` runs the type, lint, dependency, schema, CLI, property, contract, formal-model and release checks. `verify/run` exercises every feature listed in [verify/features.json](verify/features.json) against fresh temporary data and retains logs at the printed evidence directory. [The verification skill](verify/SKILL.md) explains individual feature checks. [The formal skill](verify/formal/SKILL.md) describes the model's bounds and its correspondence to the implementation. A model pass checks the model, while CLI and property tests check the binary.

`npm run release:build` writes `release/ambitious-records-0.1.1.mjs` and `release/SHA256SUMS`. The bundled file runs with Node 24 and needs no npm installation. Verify a downloaded file against `SHA256SUMS` before running it. The shared [Ambitious installer](https://github.com/AmbitiousBots/ambitious-kit) can install release assets into `$AMBITIOUS_HOME/bin` after verifying their checksums.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md). Licensed under Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
