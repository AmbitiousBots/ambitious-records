# ambitious-records

The records module stores typed records whose stage machines are defined in data (for example invoices, bookings, inventory and cases), and only declared transitions succeed. It is a command-line tool with JSON in and JSON out, one SQLite file and no UI.

The module follows the shared module contract, [MODULE_CONTRACT.md](https://github.com/AmbitiousBots/ambitious-kit/blob/main/MODULE_CONTRACT.md) in ambitious-kit: one command-line binary, JSON in and a JSON envelope out, one SQLite file, deterministic with `--now` and `--seed`, no network except keyed AI calls.

## What is here so far

The module's commands are not written yet. This repository holds what they will be built on:

| Path | What it is |
|---|---|
| `schemas/record-type.v1.json` | The JSON Schema for a record type definition. See [schemas/README.md](schemas/README.md). |
| `presets/` | Four ready-made record types as data: `invoice`, `booking`, `inventory-item` and `case`. |
| `spec/` | A TLA+ model of the stage machine, checked for the presets and for every small type. See [spec/README.md](spec/README.md). |
| `src/domain/types.ts` | The types the code will be written against. No behavior yet. |
| `verify/formal/SKILL.md` | For coding agents: when to rerun the checks and how to read a failure. |

Check everything:

```sh
bash spec/check.sh && npm ci && npx tsc --noEmit && npm run check:schemas
```

This needs Node 24, [mise](https://mise.jdx.dev) and `curl`.

Part of [Ambitious](https://ambitiousbots.com). Licensed under the Apache License, Version 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
