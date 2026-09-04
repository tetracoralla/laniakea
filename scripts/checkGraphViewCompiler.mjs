import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const version = "0.5.0";
const filename = `openadam-graph-view-compiler-${version}.tgz`;
const dependency = `file:vendor/${filename}`;
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const locked = lock.packages["node_modules/@openadam/graph-view-compiler"];
const installed = JSON.parse(await readFile(
  "node_modules/@openadam/graph-view-compiler/package.json",
  "utf8",
));

assert.equal(manifest.dependencies["@openadam/graph-view-compiler"], dependency);
assert.equal(lock.packages[""].dependencies["@openadam/graph-view-compiler"], dependency);
assert.equal(locked.version, version);
assert.equal(locked.resolved, dependency);
assert.match(locked.integrity, /^sha512-/u);
assert.equal(installed.name, "@openadam/graph-view-compiler");
assert.equal(installed.version, version);
const tarball = await readFile(`vendor/${filename}`);
const sidecar = await readFile(`vendor/${filename}.sha256`, "utf8");
const hash = createHash("sha256").update(tarball).digest("hex");
assert.equal(sidecar, `${hash}  ${filename}\n`);

const projection = await import("@openadam/graph-view-compiler");
const semantic = await import("@openadam/graph-view-compiler/semantic");
const compiler = await import("@openadam/graph-view-compiler/compiler");
assert.deepEqual(projection.endpointStylesForDirection("directed"), {
  source: "none",
  target: "arrow",
});
assert.equal(semantic.SEMANTIC_GRAPH_VERSION, 1);
assert.equal(typeof semantic.sliceSemanticGraph, "function");
assert.equal(compiler.GRAPH_VIEW_PLAN_VERSION, 1);
assert.equal(typeof compiler.compileGraphView, "function");
const constrained = compiler.compileGraphView({
  graph: {
    version: 1,
    nodes: [{ id: "a" }, { id: "b" }],
    relations: [{ id: "ab", source: "a", target: "b", direction: "directed" }],
  },
  nodeSizes: { a: { width: 80, height: 40 }, b: { width: 80, height: 40 } },
  profile: { type: "fixed", positions: { a: { x: 0, y: 0 }, b: { x: 240, y: 0 } } },
  edgeRouteConstraints: {
    ab: { type: "orthogonal-corridor", axis: "y", coordinate: 100 },
  },
});
assert.equal(constrained.edges[0].route.strategy, "constrained");
assert.equal(constrained.edges[0].route.points.some((point) => point.y === 100), true);

process.stdout.write("Graph View Compiler package checks passed.\n");
