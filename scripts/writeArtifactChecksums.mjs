import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const files = process.argv.slice(2);
assert.ok(files.length, "Provide the built installer paths");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
if (process.env.GITHUB_ACTIONS === "true") {
  assert.equal(sourceDirty, false, "Release assets require a clean, committed source tree");
}
for (const input of files) {
  const file = resolve(input);
  assert.ok(/\.(?:dmg|exe)$/i.test(file), "Expected a DMG or Windows installer");
  assert.ok(basename(file).includes(version), "Installer name must contain the current version");
  const info = await stat(file);
  assert.ok(info.isFile() && info.size > 0, "Installer must be a nonempty file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  await writeFile(`${file}.sha256`, `${sha256}  ${basename(file)}\n`);
  await writeFile(`${file}.build.json`, JSON.stringify({
    version, sourceCommit, sourceDirty, file: basename(file), bytes: info.size, sha256,
  }, null, 2) + "\n");
  console.log(`${basename(file)}: ${sha256}`);
}
