---
name: verify-records
description: Verify the Ambitious Records CLI through its bundled binary against fresh temporary databases. Use after changes to commands, fields, transitions, history, queries, migrations or release packaging, and to collect pull request evidence.
---

# Verify Ambitious Records

A module has no user interface. Its user is a bot that runs the built binary, writes JSON to it and reads one JSON envelope from stdout. This skill drives that same surface. One command runs everything:

```text
node verify/run
```

It prints one row per feature in `verify/features.json` and exits non-zero when any row fails. Its output is the evidence a pull request pastes under `## Evidence`.

## Launch

There is no server. "Launch" means installing the pinned tools and dependencies once, then building the binary:

```text
mise trust -q .
mise install -q
npm ci
npm run release:build
```

[mise](https://mise.jdx.dev) installs the tool versions pinned in `.mise.toml`. The release build creates both the development binary and the versioned release asset. It is ready when `node verify/run --doctor` prints `ok` on every row and `dist/ambitious-records.mjs` exists.

## Doctor

```text
node verify/run --doctor
```

Read-only. It checks the Node version against `package.json`, that dependencies are installed and that the feature list is well formed.

## Drive

- Everything: `node verify/run`.
- Stage transitions: `node verify/run --only moves`.
- Queries and history: `node verify/run --only query --only history --only replay`.
- The list with each check command: `node verify/run --list`.

Each check runs from the repository root with `AMBITIOUS_HOME` set to its own new, empty temporary directory. The CLI test helpers also create isolated homes and remove them after each test. Two test runs never share a database. Avoid running release builds concurrently in the same checkout because they write the same output files.

To drive the binary by hand the way a bot does, give it a home and fixed `--now` and `--seed`, then read stdout and the exit code. Every module has `selfcheck` and `commands`:

```text
export AMBITIOUS_HOME="$(mktemp -d)"
node dist/ambitious-records.mjs selfcheck --now 2026-01-01T00:00:00Z --seed 7
node dist/ambitious-records.mjs commands --now 2026-01-01T00:00:00Z --seed 7
```

## Feature map

`verify/features.json` is the map: `[{ "id", "userVisible", "check" }]`.

- `id`: lower-case words joined by hyphens.
- `userVisible`: one plain sentence saying what a person who talks to the bot can rely on.
- `check`: one shell command that exits 0 only when that is true. It must run the built binary or another real entry point, not an internal function, and must check the result as well as the action: the exit code, the envelope, the rows that were stored.

The map covers command discovery, selfcheck and migrations, type definitions and versions, creation and fields, updates, moves and allowed stages, uniqueness and concurrent writers, idempotent retries, queries, history and replay, read-only access, deterministic input, file input, release packaging, the shared contract, standalone wording and formal models. Its build feature runs first. When selecting individual test features after changing source, run `npm run release:build` first.

CLI checks use `test/helpers.mjs` to invoke the built binary and check its exit status and envelope. Property tests generate command histories and compare an independent replay with the result of `query`. The release check verifies `SHA256SUMS` and invokes a copy of the release asset without neighboring dependencies. `scripts/contract.mjs` runs the shared contract assertions with record-specific inputs. `scripts/check-models.mjs` checks model coverage and runs the kit TLC runner. Add a feature entry whenever a command gains observable behavior; keep checks failing when a required precondition is missing.

## Evidence

Paste the table `node verify/run` prints and the output of `npm run release:check`. The complete output of every feature check is written to a temporary evidence directory, one log per feature, and its path is printed on the line that starts `Full output of every check:`. Confirm that the logs still exist after the run. Capture failures as well as successes; a model pass alone does not prove the binary's behavior.

## Cleanup

`verify/run` removes every temporary `AMBITIOUS_HOME` it created. The evidence directory is kept; delete it yourself when you no longer need it. Test helpers remove their own scratch directories, also after failure. Remove a manually created home only after verifying it is the disposable directory created for this run. No server process needs to be stopped.
