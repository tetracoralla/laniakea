import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import packageManifest from "../package.json";
import {
  mindMapToAgentView,
  searchAgentMindMap,
  type AgentMapView,
  type AgentTreeInput,
  type MindMapOperation,
} from "../src/agent/mindMapTools";
import {
  createMindMapFile,
  readMindMapFile,
  updateMindMapFile,
  type LoadedMindMapFile,
} from "./mindMapFileStore";

const filePathSchema = z
  .string()
  .min(1)
  .describe("Explicit absolute path to one .md or .markdown file.");

const treeInputSchema = z
  .object({
    text: z.string().max(20_000),
    children: z.array(z.unknown()).max(10_000).optional(),
  })
  .describe(
    "A recursive mind-map node. Every child uses this same { text, children? } shape; the complete tree is validated iteratively before construction.",
  );

const operationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_title"),
    title: z.string().max(1_000),
  }),
  z.object({
    type: z.literal("set_text"),
    ref: z.string().min(2),
    text: z.string().max(20_000),
  }),
  z.object({
    type: z.literal("add_child"),
    parentRef: z.string().min(2),
    node: treeInputSchema,
    position: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal("add_sibling"),
    siblingRef: z.string().min(2),
    node: treeInputSchema,
    placement: z.enum(["before", "after"]).optional(),
  }),
  z.object({
    type: z.literal("move_subtree"),
    ref: z.string().min(2),
    newParentRef: z
      .string()
      .min(2)
      .nullable()
      .describe("Destination node reference, or null to promote the branch to a top-level floating root."),
    position: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal("delete_subtree"),
    ref: z.string().min(2),
  }),
]);

const nodeViewSchema = z.object({
  ref: z.string(),
  parentRef: z.string().nullable(),
  depth: z.number().int(),
  text: z.string(),
  childCount: z.number().int(),
  breadcrumb: z.array(z.string()),
});

const snapshotSchema = z.object({
  filePath: z.string(),
  revision: z.string(),
  title: z.string(),
  sourceKind: z.enum(["outline", "rich"]),
  canUpdate: z.boolean(),
  nodeCount: z.number().int(),
  nodes: z.array(nodeViewSchema),
  truncated: z.boolean(),
});

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

function snapshot(
  loaded: LoadedMindMapFile,
  view: AgentMapView,
) {
  return {
    filePath: loaded.filePath,
    revision: loaded.revision,
    ...view,
  };
}

function renderView(view: ReturnType<typeof snapshot>) {
  const outline = view.nodes.length
    ? view.nodes
        .map(
          (node) =>
            `${"  ".repeat(node.depth)}- ${node.text || "(empty)"} [${node.ref}]`,
        )
        .join("\n")
    : "No matching nodes.";
  const suffix = view.truncated ? "\n… result truncated; narrow the read or search." : "";
  return `${view.title}\nRevision: ${view.revision}\n${outline}${suffix}`;
}

function successResult(structuredContent: object, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { ...structuredContent },
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function createLaniakeaServer() {
  const server = new McpServer(
    { name: "laniakea", version: packageManifest.version },
    {
      instructions:
        "Use Laniakea for durable, user-visible hierarchical artifacts, not as private scratch reasoning. Read before updating, pass the exact revision, and never rewrite a rich Markdown source in place.",
    },
  );

  server.registerTool(
    "read_mind_map",
    {
      annotations: readOnlyAnnotations,
      title: "Read a Laniakea mind map",
      description:
        "Use this when the user wants to inspect or continue working with one explicit Markdown mind map. Returns revision-bound node references for safe follow-up edits; it never scans folders.",
      inputSchema: z.object({
        filePath: filePathSchema,
        rootRef: z
          .string()
          .min(2)
          .optional()
          .describe("Optional node reference from an earlier read to limit the result to one subtree."),
        maxDepth: z.number().int().min(0).max(64).optional(),
        maxNodes: z.number().int().min(1).max(5_000).optional(),
      }),
      outputSchema: snapshotSchema,
    },
    async ({ filePath, rootRef, maxDepth, maxNodes }) => {
      try {
        const loaded = await readMindMapFile(filePath);
        const result = snapshot(
          loaded,
          mindMapToAgentView(loaded.parsed, {
            rootRef,
            maxDepth,
            maxNodes,
          }),
        );
        return successResult(result, renderView(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_mind_map",
    {
      annotations: readOnlyAnnotations,
      title: "Search a Laniakea mind map",
      description:
        "Use this to locate nodes by text in one explicit Markdown mind map before editing a large structure. Returns revision-bound references and breadcrumbs.",
      inputSchema: z.object({
        filePath: filePathSchema,
        query: z.string().min(1).max(2_000),
        maxResults: z.number().int().min(1).max(500).optional(),
      }),
      outputSchema: snapshotSchema,
    },
    async ({ filePath, query, maxResults }) => {
      try {
        const loaded = await readMindMapFile(filePath);
        const result = snapshot(
          loaded,
          searchAgentMindMap(loaded.parsed, query, maxResults),
        );
        return successResult(result, renderView(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "create_mind_map",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      title: "Create a Laniakea mind map",
      description:
        "Use this when the user wants a new durable Markdown mind map at an explicit path. Creates only a new file and refuses to overwrite an existing file.",
      inputSchema: z.object({
        filePath: filePathSchema,
        title: z.string().max(1_000),
        root: treeInputSchema,
      }),
      outputSchema: snapshotSchema,
    },
    async ({ filePath, title, root }) => {
      try {
        const loaded = await createMindMapFile(
          filePath,
          title,
          root as AgentTreeInput,
        );
        const result = snapshot(loaded, mindMapToAgentView(loaded.parsed));
        return successResult(result, `Created ${loaded.filePath}\n${renderView(result)}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "update_mind_map",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      title: "Update a Laniakea mind map",
      description:
        "Use this to atomically apply one reviewed batch of semantic node changes to an explicit Laniakea outline. Requires the exact revision from read_mind_map or search_mind_map, rejects concurrent changes, and refuses to rewrite rich Markdown.",
      inputSchema: z.object({
        filePath: filePathSchema,
        expectedRevision: z.string().startsWith("sha256:"),
        dryRun: z
          .boolean()
          .optional()
          .describe("When true, validate and preview the result without writing the file."),
        operations: z.array(operationSchema).min(1).max(100),
      }),
      outputSchema: snapshotSchema.extend({
        wrote: z.boolean(),
        appliedOperationCount: z.number().int(),
      }),
    },
    async ({ filePath, expectedRevision, dryRun, operations }) => {
      try {
        const updated = await updateMindMapFile(
          filePath,
          expectedRevision,
          operations as MindMapOperation[],
          dryRun,
        );
        const result = {
          ...snapshot(updated, mindMapToAgentView(updated.parsed)),
          wrote: updated.wrote,
          appliedOperationCount: operations.length,
        };
        const prefix = updated.wrote ? "Updated" : "Dry-run preview for";
        return successResult(result, `${prefix} ${updated.filePath}\n${renderView(result)}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

async function main() {
  const server = createLaniakeaServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("Laniakea MCP server failed:", error);
  process.exitCode = 1;
});
