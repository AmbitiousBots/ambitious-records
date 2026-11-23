# Verification tools

`tlc.mjs`, `tla2tools.mjs`, and `check-standalone.mjs` come from
[ambitious-kit kit-v0.4.9](https://github.com/AmbitiousBots/ambitious-kit/releases/tag/kit-v0.4.9).
The TLC runner reads the final distinct-state count instead of the first
progress report. `check-models.mjs` retains the stage machine's additional
checks for variant drift, invariant coverage, and state exploration.

`contract.mjs` is the kit 0.4.9 contract adapter. It reads
`@ambitious/kit/contract/checks` and refuses to run unless the line
`const stdin = input ? "{}" : "";` appears exactly once. It replaces that
line so the read-only probe sends a fixture object: `type get` and `query`
receive `{"type":"entry"}`, and `allowed` and `history` receive
`{"id":"missing-record"}`. A read command that takes input must have a fixture.
The adapted source is bundled with esbuild and `runContract` runs against the
built module. The seven kit checks, including `--help` and
`listed-shapes`, stay in the kit. The module's CLI tests separately check
that invalid input is rejected before opening a database and that reads
preserve existing records and history.

The kit packages in `vendor/` are the
[kit-v0.4.9](https://github.com/AmbitiousBots/ambitious-kit/releases/tag/kit-v0.4.9)
release assets `ambitious-kit`, `ambitious-lint` and `ambitious-depcruise`.
Their SHA-256 hashes are in `vendor/SHA256SUMS`; check them from that
directory with `sha256sum -c SHA256SUMS`.

`release-build.mjs` bundles the CLI and its migrations, then writes the executable
and checksum into `release/`. `release-check.mjs` runs every repository gate and
reports all failures. Run it with the toolchain pinned in `.mise.toml`.
The release checker and `verify/run` apply the mise environment to child checks,
so they use the pinned tools even when the caller has not activated mise in the shell.
