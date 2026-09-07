import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const bundle = resolve(process.argv[2]);
const resources = resolve(bundle, "Contents/Resources");
for (const [source, packaged] of [
  ["LICENSE", "licenses/LICENSE"],
  ["NOTICE", "licenses/NOTICE"],
  ["dist/THIRD_PARTY_NOTICES.txt", "licenses/THIRD_PARTY_NOTICES.web.txt"],
  ["src-tauri/notices/THIRD_PARTY_NOTICES.txt", "licenses/THIRD_PARTY_NOTICES.native.txt"],
  ["src-tauri/notices/inventory.json", "licenses/native-inventory.json"],
  ["src-tauri/icons/icon.icns", "icon.icns"],
]) {
  const expected = await readFile(source);
  assert.ok(expected.length > 0, `Empty distribution input: ${source}`);
  assert.deepEqual(await readFile(resolve(resources, packaged)), expected, `Packaged bytes differ: ${packaged}`);
}
console.log("Desktop bundle icon and distribution notices match build inputs");
