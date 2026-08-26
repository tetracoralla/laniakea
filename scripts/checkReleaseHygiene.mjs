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

console.log("release hygiene checks passed");
