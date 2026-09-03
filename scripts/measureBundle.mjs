import { gzipSync } from "node:zlib";
import { build } from "vite";

function packageName(moduleId) {
  const marker = "/node_modules/";
  const index = moduleId.lastIndexOf(marker);
  if (index < 0) return "app";
  const relative = moduleId.slice(index + marker.length);
  const [first, second] = relative.split("/");
  return first.startsWith("@") ? `${first}/${second}` : first;
}

function rankedModules(chunk) {
  const totals = new Map();
  for (const [moduleId, details] of Object.entries(chunk.modules)) {
    const owner = packageName(moduleId);
    totals.set(owner, (totals.get(owner) ?? 0) + details.renderedLength);
  }
  return [...totals.entries()]
    .map(([owner, renderedBytes]) => ({ owner, renderedBytes }))
    .sort((left, right) => right.renderedBytes - left.renderedBytes);
}

const result = await build({
  configFile: "vite.config.ts",
  logLevel: "silent",
  build: {
    write: false,
  },
});
const outputs = Array.isArray(result) ? result : [result];
const chunks = outputs
  .flatMap(({ output }) => output)
  .filter((entry) => entry.type === "chunk")
  .map((chunk) => ({
    file: chunk.fileName,
    entry: chunk.isEntry,
    bytes: Buffer.byteLength(chunk.code),
    gzipBytes: gzipSync(chunk.code).byteLength,
    owners: rankedModules(chunk).slice(0, 12),
  }))
  .sort((left, right) => right.bytes - left.bytes);

console.log(JSON.stringify({
  status: "measured",
  chunks,
  totalJavaScriptBytes: chunks.reduce((total, chunk) => total + chunk.bytes, 0),
  totalJavaScriptGzipBytes: chunks.reduce(
    (total, chunk) => total + chunk.gzipBytes,
    0,
  ),
}, null, 2));
