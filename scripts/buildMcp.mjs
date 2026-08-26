import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { writeThirdPartyNotices } from "./generateThirdPartyNotices.mjs";

await mkdir("plugins/laniakea/server", { recursive: true });

const result = await build({
  bundle: true,
  entryPoints: ["mcp/server.ts"],
  format: "esm",
  legalComments: "external",
  logLevel: "info",
  metafile: true,
  minifyWhitespace: true,
  outfile: "plugins/laniakea/server/index.mjs",
  platform: "node",
  target: "node20",
});

const bundlePath = "plugins/laniakea/server/index.mjs";
const bundle = await readFile(bundlePath, "utf8");
await writeFile(bundlePath, bundle.replace(/[ \t]+$/gm, ""));

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
await writeThirdPartyNotices({
  repositoryRoot,
  bundledInputs: Object.keys(result.metafile.inputs),
  outputPaths: [
    fileURLToPath(
      new URL("../plugins/laniakea/THIRD_PARTY_NOTICES.md", import.meta.url),
    ),
  ],
  productName: "Laniakea",
});

await Promise.all([
  copyFile(
    new URL("../LICENSE", import.meta.url),
    new URL("../plugins/laniakea/LICENSE", import.meta.url),
  ),
  copyFile(
    new URL("../NOTICE", import.meta.url),
    new URL("../plugins/laniakea/NOTICE", import.meta.url),
  ),
]);
