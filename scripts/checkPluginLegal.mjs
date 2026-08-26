import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const file of ["LICENSE", "NOTICE"]) {
  const root = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const plugin = await readFile(
    new URL(`../plugins/laniakea/${file}`, import.meta.url),
    "utf8",
  );
  assert.equal(plugin, root, `Standalone plugin ${file} differs from the repository copy`);
}

const notices = await readFile(
  new URL("../plugins/laniakea/THIRD_PARTY_NOTICES.md", import.meta.url),
  "utf8",
);
assert.match(notices, /^# Third-party notices$/m);
assert.match(notices, /^## @modelcontextprotocol\/sdk@/m);
assert.match(notices, /^## unified@/m);

console.log("standalone plugin legal files are present and synchronized");
