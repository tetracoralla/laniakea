import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("plugins/laniakea/server", { recursive: true });

await build({
  bundle: true,
  entryPoints: ["mcp/server.ts"],
  format: "esm",
  logLevel: "info",
  minifyWhitespace: true,
  outfile: "plugins/laniakea/server/index.mjs",
  platform: "node",
  target: "node20",
});

const bundlePath = "plugins/laniakea/server/index.mjs";
const bundle = await readFile(bundlePath, "utf8");
await writeFile(bundlePath, bundle.replace(/[ \t]+$/gm, ""));
