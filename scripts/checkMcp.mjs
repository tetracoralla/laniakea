import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pluginRoot = resolve(process.argv[2] ?? "plugins/laniakea");
const packageManifest = JSON.parse(
  await readFile(resolve("package.json"), "utf8"),
);
const tauriManifest = JSON.parse(
  await readFile(resolve("src-tauri/tauri.conf.json"), "utf8"),
);
const pluginManifest = JSON.parse(
  await readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
);
const packageVersion = packageManifest.version;
assert.equal(tauriManifest.version, packageVersion);
assert.equal(pluginManifest.version.split("+")[0], packageVersion);
const workspace = await mkdtemp(join(tmpdir(), "laniakea-mcp-check-"));
const mapPath = join(workspace, "launch-plan.md");
const richPath = join(workspace, "rich-source.md");
const concurrentPath = join(workspace, "concurrent.md");
const largePath = join(workspace, "large.md");
const transport = new StdioClientTransport({
  args: ["./server/index.mjs"],
  command: process.execPath,
  cwd: pluginRoot,
  stderr: "pipe",
});
const client = new Client({ name: "laniakea-check", version: packageVersion });
const concurrentTransport = new StdioClientTransport({
  args: ["./server/index.mjs"],
  command: process.execPath,
  cwd: pluginRoot,
  stderr: "pipe",
});
const concurrentClient = new Client({
  name: "laniakea-concurrency-check",
  version: packageVersion,
});

try {
  await client.connect(transport);
  await concurrentClient.connect(concurrentTransport);
  assert.equal(client.getServerVersion()?.version, packageVersion);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    ["create_mind_map", "read_mind_map", "search_mind_map", "update_mind_map"],
  );
  assert.equal(
    listed.tools.find((tool) => tool.name === "read_mind_map")?.annotations
      ?.readOnlyHint,
    true,
  );
  assert.equal(
    listed.tools.find((tool) => tool.name === "update_mind_map")?.annotations
      ?.destructiveHint,
    true,
  );

  const created = await client.callTool({
    name: "create_mind_map",
    arguments: {
      filePath: mapPath,
      title: "Launch Plan",
      root: {
        text: "Release",
        children: [
          { text: "Product", children: [{ text: "Scope" }] },
          { text: "Risk" },
        ],
      },
    },
  });
  assert.equal(created.isError, undefined, JSON.stringify(created));
  const createdRevision = created.structuredContent?.revision;
  assert.match(createdRevision, /^sha256:/);

  const read = await client.callTool({
    name: "read_mind_map",
    arguments: { filePath: mapPath },
  });
  assert.equal(read.structuredContent?.nodeCount, 4);
  assert.equal(read.structuredContent?.nodes?.[1]?.ref, "/0/0");

  const searched = await client.callTool({
    name: "search_mind_map",
    arguments: { filePath: mapPath, query: "scope" },
  });
  assert.equal(searched.structuredContent?.nodes?.[0]?.ref, "/0/0/0");

  const beforeDryRun = await readFile(mapPath, "utf8");
  const dryRun = await client.callTool({
    name: "update_mind_map",
    arguments: {
      filePath: mapPath,
      expectedRevision: createdRevision,
      dryRun: true,
      operations: [
        { type: "set_text", ref: "/0/1", text: "Risks" },
        {
          type: "add_child",
          parentRef: "/0/1",
          node: { text: "Data loss" },
        },
      ],
    },
  });
  assert.equal(dryRun.structuredContent?.wrote, false);
  assert.equal(await readFile(mapPath, "utf8"), beforeDryRun);

  const updated = await client.callTool({
    name: "update_mind_map",
    arguments: {
      filePath: mapPath,
      expectedRevision: createdRevision,
      operations: [
        { type: "set_text", ref: "/0/1", text: "Risks" },
        {
          type: "add_child",
          parentRef: "/0/1",
          node: { text: "Data loss" },
        },
      ],
    },
  });
  assert.equal(updated.isError, undefined, JSON.stringify(updated));
  assert.equal(updated.structuredContent?.wrote, true);
  assert.match(await readFile(mapPath, "utf8"), /Data loss/);

  await writeFile(mapPath, `${await readFile(mapPath, "utf8")}\n`, "utf8");
  const stale = await client.callTool({
    name: "update_mind_map",
    arguments: {
      filePath: mapPath,
      expectedRevision: updated.structuredContent?.revision,
      operations: [{ type: "set_title", title: "Stale overwrite" }],
    },
  });
  assert.equal(stale.isError, true);
  assert.doesNotMatch(await readFile(mapPath, "utf8"), /Stale overwrite/);

  await writeFile(
    richPath,
    "# Rich source\n\n| Key | Value |\n| --- | --- |\n| Safe | Keep me |\n",
    "utf8",
  );
  const richRead = await client.callTool({
    name: "read_mind_map",
    arguments: { filePath: richPath },
  });
  assert.equal(richRead.structuredContent?.canUpdate, false);
  const richUpdate = await client.callTool({
    name: "update_mind_map",
    arguments: {
      filePath: richPath,
      expectedRevision: richRead.structuredContent?.revision,
      operations: [{ type: "set_title", title: "Do not overwrite" }],
    },
  });
  assert.equal(richUpdate.isError, true);
  assert.match(await readFile(richPath, "utf8"), /Keep me/);

  const duplicateCreate = await client.callTool({
    name: "create_mind_map",
    arguments: {
      filePath: mapPath,
      title: "Overwrite",
      root: { text: "Forbidden" },
    },
  });
  assert.equal(duplicateCreate.isError, true);

  let tooDeepRoot = { text: "Leaf" };
  for (let depth = 0; depth < 3_000; depth += 1) {
    tooDeepRoot = { text: `Level ${depth}`, children: [tooDeepRoot] };
  }
  const tooDeep = await client.callTool({
    name: "create_mind_map",
    arguments: {
      filePath: join(workspace, "too-deep.md"),
      title: "Too deep",
      root: tooDeepRoot,
    },
  });
  assert.equal(tooDeep.isError, true);
  assert.match(tooDeep.content?.[0]?.text ?? "", /64 levels/);

  await writeFile(
    largePath,
    [
      "# Large",
      "",
      "- Root",
      ...Array.from({ length: 10_001 }, (_, index) =>
        `  - ${index === 10_000 ? "Needle after limit" : `Node ${index}`}`,
      ),
      "",
    ].join("\n"),
    "utf8",
  );
  const completeSearch = await client.callTool({
    name: "search_mind_map",
    arguments: { filePath: largePath, query: "needle after limit" },
  });
  assert.equal(completeSearch.isError, undefined, JSON.stringify(completeSearch));
  assert.equal(completeSearch.structuredContent?.nodeCount, 10_002);
  assert.equal(
    completeSearch.structuredContent?.nodes?.[0]?.text,
    "Needle after limit",
  );

  for (let round = 0; round < 40; round += 1) {
    await writeFile(
      concurrentPath,
      `# Concurrent ${round}\n\n- Root\n`,
      "utf8",
    );
    const concurrentRead = await client.callTool({
      name: "read_mind_map",
      arguments: { filePath: concurrentPath },
    });
    const revision = concurrentRead.structuredContent?.revision;
    const results = await Promise.all([
      client.callTool({
        name: "update_mind_map",
        arguments: {
          filePath: concurrentPath,
          expectedRevision: revision,
          operations: [{ type: "set_title", title: `First ${round}` }],
        },
      }),
      concurrentClient.callTool({
        name: "update_mind_map",
        arguments: {
          filePath: concurrentPath,
          expectedRevision: revision,
          operations: [{ type: "set_title", title: `Second ${round}` }],
        },
      }),
    ]);
    assert.equal(
      results.filter((result) => result.isError !== true).length,
      1,
      `round ${round} allowed more than one concurrent writer`,
    );
    assert.equal(
      results.filter((result) => result.isError === true).length,
      1,
      `round ${round} did not report a revision conflict`,
    );
  }

  console.log(
    "MCP runtime check passed: discovery, complete large-map search, depth guard, create/read/search, dry-run, atomic update, 40-round cross-process serialization, stale conflict, rich-source protection, and no-overwrite create.",
  );
} finally {
  await concurrentClient.close().catch(() => undefined);
  await client.close().catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
}
