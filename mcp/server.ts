import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import packageManifest from "../package.json";
import {
  mindMapToAgentView,
  searchAgentMindMap,
  type AgentTreeInput,
  type MindMapOperation,
} from "../src/agent/mindMapTools";
import {
  createMindMapFile,
  readMindMapFile,
  updateMindMapFile,
} from "./mindMapFileStore";
import {
  assertMcpRequestBudget,
  MAX_MCP_REQUEST_BYTES,
} from "./requestBudget";
import {
  boundedErrorResult,
  boundedSnapshotResult,
  MAX_MCP_RESPONSE_BYTES,
  snapshotSource,
} from "./resultEnvelope";

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
  breadcrumbTruncated: z.boolean(),
  textTruncated: z.boolean(),
  subspace: z
    .discriminatedUnion("type", [
      z.object({
        id: z.string(),
        type: z.literal("flow"),
        nodeCount: z.number().int(),
        edgeCount: z.number().int(),
        truncated: z.boolean(),
        nodes: z.array(
          z.object({
            ref: z.string(),
            kind: z.enum(["start", "step", "decision", "end"]),
            text: z.string(),
            textTruncated: z.boolean(),
            outgoing: z.array(
              z.object({
                toRef: z.string(),
                label: z.string(),
                labelTruncated: z.boolean(),
              }),
            ),
            outgoingTruncated: z.boolean(),
          }),
        ),
      }),
      z.object({
        id: z.string(),
        type: z.literal("map"),
        nodeCount: z.number().int(),
        truncated: z.boolean(),
        nodes: z.array(
          z.object({
            ref: z.string(),
            parentRef: z.string().nullable(),
            depth: z.number().int(),
            text: z.string(),
            textTruncated: z.boolean(),
            childCount: z.number().int(),
          }),
        ),
      }),
    ])
    .optional(),
});

const truncationReasonSchema = z.enum([
  "max_depth",
  "max_nodes",
  "max_results",
  "response_bytes",
]);

const snapshotSchema = z.object({
  filePath: z.string(),
  revision: z.string(),
  title: z.string(),
  titleTruncated: z.boolean(),
  sourceKind: z.enum(["outline", "rich"]),
  canUpdate: z.boolean(),
  nodeCount: z.number().int(),
  nodes: z.array(nodeViewSchema),
  returnedNodeCount: z.number().int(),
  responseLimitBytes: z.literal(MAX_MCP_RESPONSE_BYTES),
  truncated: z.boolean(),
  truncationReasons: z.array(truncationReasonSchema),
});

const errorPayloadSchema = z.object({
  code: z.enum([
    "already_exists",
    "busy",
    "conflict",
    "file_too_large",
    "invalid_path",
    "not_found",
    "invalid_ref",
    "invalid_operation",
    "protected_source",
    "too_deep",
    "too_large",
    "permission_denied",
    "io_error",
    "request_too_large",
  ]),
  message: z.string(),
  messageTruncated: z.boolean(),
});

// The current MCP SDK can publish and validate only an object-shaped output
// schema. Keep one tagged, closed envelope so clients can accept both success
// and error structuredContent without losing existing top-level success fields.
const snapshotResultSchema = snapshotSchema.partial().extend({
  status: z.enum(["ok", "error"]),
  error: errorPayloadSchema.optional(),
  responseLimitBytes: z.literal(MAX_MCP_RESPONSE_BYTES),
});

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

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
        `Use this when the user wants to inspect or continue working with one explicit Markdown mind map. Returns revision-bound node references for safe follow-up edits; it never scans folders. Complete request limit: ${MAX_MCP_REQUEST_BYTES} UTF-8 JSON bytes.`,
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
      outputSchema: snapshotResultSchema,
    },
    async ({ filePath, rootRef, maxDepth, maxNodes }) => {
      try {
        assertMcpRequestBudget({ filePath, rootRef, maxDepth, maxNodes });
        const loaded = await readMindMapFile(filePath);
        const result = snapshotSource(
          loaded,
          mindMapToAgentView(loaded.parsed, {
            rootRef,
            maxDepth,
            maxNodes,
          }),
        );
        return boundedSnapshotResult(result);
      } catch (error) {
        return boundedErrorResult(error);
      }
    },
  );

  server.registerTool(
    "search_mind_map",
    {
      annotations: readOnlyAnnotations,
      title: "Search a Laniakea mind map",
      description:
        `Use this to locate nodes by text in one explicit Markdown mind map before editing a large structure. Returns revision-bound references and breadcrumbs. Complete request limit: ${MAX_MCP_REQUEST_BYTES} UTF-8 JSON bytes.`,
      inputSchema: z.object({
        filePath: filePathSchema,
        query: z.string().min(1).max(2_000),
        maxResults: z.number().int().min(1).max(500).optional(),
      }),
      outputSchema: snapshotResultSchema,
    },
    async ({ filePath, query, maxResults }) => {
      try {
        assertMcpRequestBudget({ filePath, query, maxResults });
        const loaded = await readMindMapFile(filePath);
        const result = snapshotSource(
          loaded,
          searchAgentMindMap(loaded.parsed, query, maxResults),
        );
        return boundedSnapshotResult(result);
      } catch (error) {
        return boundedErrorResult(error);
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
        `Use this when the user wants a new durable Markdown mind map at an explicit path. Creates only a new file and refuses to overwrite an existing file. Complete request limit: ${MAX_MCP_REQUEST_BYTES} UTF-8 JSON bytes.`,
      inputSchema: z.object({
        filePath: filePathSchema,
        title: z.string().max(1_000),
        root: treeInputSchema,
      }),
      outputSchema: snapshotResultSchema,
    },
    async ({ filePath, title, root }) => {
      try {
        assertMcpRequestBudget({ filePath, title, root });
        const loaded = await createMindMapFile(
          filePath,
          title,
          root as AgentTreeInput,
        );
        const result = snapshotSource(loaded, mindMapToAgentView(loaded.parsed));
        return boundedSnapshotResult(result, `Created ${loaded.filePath}`);
      } catch (error) {
        return boundedErrorResult(error);
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
        `Use this to atomically apply one reviewed batch of semantic node changes to an explicit Laniakea outline. Requires the exact revision from read_mind_map or search_mind_map, rejects concurrent changes, and refuses to rewrite rich Markdown. Complete request limit: ${MAX_MCP_REQUEST_BYTES} UTF-8 JSON bytes.`,
      inputSchema: z.object({
        filePath: filePathSchema,
        expectedRevision: z.string().startsWith("sha256:"),
        dryRun: z
          .boolean()
          .optional()
          .describe("When true, validate and preview the result without writing the file."),
        operations: z.array(operationSchema).min(1).max(100),
      }),
      outputSchema: snapshotResultSchema.extend({
        wrote: z.boolean().optional(),
        appliedOperationCount: z.number().int().optional(),
      }),
    },
    async ({ filePath, expectedRevision, dryRun, operations }) => {
      try {
        assertMcpRequestBudget({
          filePath,
          expectedRevision,
          dryRun,
          operations,
        });
        const updated = await updateMindMapFile(
          filePath,
          expectedRevision,
          operations as MindMapOperation[],
          dryRun,
        );
        const result = {
          ...snapshotSource(updated, mindMapToAgentView(updated.parsed)),
          wrote: updated.wrote,
          appliedOperationCount: operations.length,
        };
        const prefix = updated.wrote ? "Updated" : "Dry-run preview for";
        return boundedSnapshotResult(result, `${prefix} ${updated.filePath}`);
      } catch (error) {
        return boundedErrorResult(error);
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
