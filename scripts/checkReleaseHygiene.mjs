import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const forbiddenLegacyAssets = [
  "docs/design/origin-browser-final.jpg",
  "docs/design/origin-primary-screen.png",
];

for (const relativePath of forbiddenLegacyAssets) {
  await assert.rejects(
    access(new URL(`../${relativePath}`, import.meta.url)),
    `Legacy branded asset is still present: ${relativePath}`,
  );
}

const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
assert.match(agents, /^# Laniakea 仓库指引$/m);
assert.doesNotMatch(agents, /^# 原点仓库指引$/m);

const productModel = await readFile(
  new URL("../docs/product-model.md", import.meta.url),
  "utf8",
);
assert.match(productModel, /视觉参考：`docs\/design\/laniakea-overview\.jpg`/u);
await access(new URL("../docs/design/laniakea-overview.jpg", import.meta.url));

const publicErrorSource = await readFile(
  new URL("../src/persistence/localDocumentStore.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(publicErrorSource, /原点无法完整保留/u);

const packageManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const pluginManifest = JSON.parse(
  await readFile(
    new URL("../plugins/laniakea/.codex-plugin/plugin.json", import.meta.url),
    "utf8",
  ),
);
const cargoManifest = await readFile(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const cargoLock = await readFile(
  new URL("../src-tauri/Cargo.lock", import.meta.url),
  "utf8",
);
const cargoManifestVersion = cargoManifest.match(
  /^version = "([^"]+)"$/mu,
)?.[1];
const cargoLockVersion = cargoLock.match(
  /\[\[package\]\]\nname = "laniakea"\nversion = "([^"]+)"/u,
)?.[1];
const pluginBaseVersion = pluginManifest.version?.split("+")[0];
const canonicalVersion = packageManifest.version;

assert.equal(packageLock.version, canonicalVersion);
assert.equal(packageLock.packages?.[""]?.version, canonicalVersion);
assert.equal(tauriConfig.version, canonicalVersion);
assert.equal(cargoManifestVersion, canonicalVersion);
assert.equal(cargoLockVersion, canonicalVersion);
assert.equal(pluginBaseVersion, canonicalVersion);

const signedMacWorkflow = await readFile(
  new URL("../.github/workflows/release-macos.yml", import.meta.url),
  "utf8",
);
assert.match(signedMacWorkflow, /^\s{2}workflow_dispatch:/mu);
assert.doesNotMatch(
  signedMacWorkflow,
  /^\s{2}push:/mu,
  "Source-only tags must not automatically start the credential-gated DMG workflow",
);

console.log("release hygiene checks passed");
