import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.equal(process.platform, "darwin", "DMG validation requires macOS");
assert.ok(process.argv[2], "Provide the DMG path and optional universal architecture requirement");
const dmg = resolve(process.argv[2]);
const mount = await mkdtemp(join(tmpdir(), "laniakea-dmg-"));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let mounted = false;
try {
  run("hdiutil", ["verify", dmg]);
  run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
  mounted = true;
  const app = join(mount, "Laniakea.app");
  console.log(run(process.execPath, ["scripts/checkDesktopBundle.mjs", app]).trim());
  run("codesign", ["--verify", "--deep", "--strict", app]);
  const architectures = run("lipo", ["-archs", join(app, "Contents/MacOS/laniakea")]).trim();
  if (process.argv[3] === "universal") {
    assert.ok(architectures.includes("arm64") && architectures.includes("x86_64"), "Expected both macOS architectures");
  }
  console.log(`PASS: DMG integrity, app signature integrity and packaged resources; architectures: ${architectures}`);
  console.log("This check does not certify Developer ID, notarization, Gatekeeper acceptance or user flows.");
} finally {
  if (mounted) run("hdiutil", ["detach", mount]);
  await rm(mount, { recursive: true });
}
