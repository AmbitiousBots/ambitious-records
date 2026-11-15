import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "./build.mjs";

const root = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const name = `ambitious-records-${version}.mjs`;
const directory = join(root, "release");
mkdirSync(directory, { recursive: true });
copyFileSync(join(root, "dist", "ambitious-records.mjs"), join(directory, name));
chmodSync(join(directory, name), 0o755);
const digest = createHash("sha256").update(readFileSync(join(directory, name))).digest("hex");
writeFileSync(join(directory, "SHA256SUMS"), `${digest}  ${name}\n`);
process.stdout.write(`Release ${version} built in release/:\n${digest}  ${name}\n`);
