# Contributing

Ambitious Records stores typed records and their stage changes through a JSON command-line interface. Contributions should make that interface easier to use or strengthen a behavior it promises.

## Set up and check a change

Install [mise](https://mise.jdx.dev) and clone this repository. Run these commands from its root:

```sh
mise trust -q .
mise install -q
npm ci
npm run release:check
verify/run
npm outdated
npm audit
```

The tools and dependencies are pinned. The checks use temporary data directories. For manual commands, set `AMBITIOUS_HOME` to a separate directory and run `selfcheck` before using the database. Do not use a database that holds data you need for development tests.

## Make a focused pull request

Read [AGENTS.md](AGENTS.md) for the directory boundaries and [MODULE_CONTRACT.md](MODULE_CONTRACT.md) for command behavior. Keep pure rules in `src/domain`, database operations in `src/db` and command wiring in `src/cli`. Database changes use forward-only files in `migrations/`; add a test for each migration.

Write tests through the command-line interface for observable behavior. When a change affects transitions, retries or transaction boundaries, check its correspondence to [the formal model](verify/formal/SKILL.md). Update the feature map and command documentation with the behavior. Do not weaken a failing check to accept an unintended change.

Use a short, plain-language title. Explain why the change helps a caller, what changed, the checks you ran and the design choices you made. Include actual command output and name any checks you could not run. Keep documentation understandable without access to other projects or a particular machine. Do not include credentials, private data or personal machine paths.

## Report a problem

For ordinary bugs, use the bug-report issue template with the version, a minimal input and the observed result. Replace private field values with synthetic examples. For possible vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of filing public details.

Contributions remain under the repository's [Apache-2.0 license](LICENSE). Participation follows the [code of conduct](CODE_OF_CONDUCT.md).
