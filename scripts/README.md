# Verification tools

`tlc.mjs`, `tla2tools.mjs`, and `check-standalone.mjs` come from
[ambitious-kit kit-v0.1.1](https://github.com/AmbitiousBots/ambitious-kit/releases/tag/kit-v0.1.1).
The TLC runner reads the final distinct-state count instead of the first
progress report. `check-models.mjs` retains the stage machine's additional
checks for variant drift, invariant coverage, and state exploration.

`contract-checks.mjs` is the kit-v0.1.1 contract checker with three package
imports and an added input-fixture callback. All six checks and their assertions
are unchanged. The original checker sends `{}` to every read command, which
cannot reach the database for commands that require an ID or type. The callback
supplies valid input from `contract.mjs` so those commands exercise the required
missing-database error and read-only open. A missing fixture fails the check.
The module's CLI tests separately check that invalid input is rejected before
opening a database and that reads preserve existing records and history.

The kit packages in `vendor/` are unchanged release assets. Their SHA-256 hashes
are in `vendor/SHA256SUMS`; check them from that directory with
`shasum -a 256 -c SHA256SUMS`.

`release-build.mjs` bundles the CLI and its migrations, then writes the executable
and checksum into `release/`. `release-check.mjs` runs every repository gate and
reports all failures. Run it with the toolchain pinned in `.mise.toml`.
The release checker and `verify/run` apply the mise environment to child checks,
so they use the pinned tools even when the caller has not activated mise in the shell.
