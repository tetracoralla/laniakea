import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

assert.ok(process.argv[2], "Usage: node scripts/checkDesktopBundle.mjs <app-or-install-directory> [windows]");
const bundle = resolve(process.argv[2]);
const windows = process.argv[3] === "windows";
const resources = windows ? bundle : resolve(bundle, "Contents/Resources");
const inputs = [
  ["LICENSE", "licenses/LICENSE"],
  ["NOTICE", "licenses/NOTICE"],
  ["dist/THIRD_PARTY_NOTICES.txt", "licenses/THIRD_PARTY_NOTICES.web.txt"],
  ["src-tauri/notices/THIRD_PARTY_NOTICES.txt", "licenses/THIRD_PARTY_NOTICES.native.txt"],
  ["src-tauri/notices/inventory.json", "licenses/native-inventory.json"],
];
if (!windows) inputs.push(["src-tauri/icons/icon.icns", "icon.icns"]);
for (const [source, packaged] of inputs) {
  const expected = await readFile(source);
  assert.ok(expected.length > 0, `Empty distribution input: ${source}`);
  assert.deepEqual(await readFile(resolve(resources, packaged)), expected, `Packaged bytes differ: ${packaged}`);
}
console.log("Desktop distribution resources match build inputs");
