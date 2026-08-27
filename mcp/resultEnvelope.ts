import {
  MindMapToolError,
  type AgentMapView,
  type AgentNodeView,
  type AgentViewTruncationReason,
} from "../src/agent/mindMapTools";
import {
  MindMapFileError,
  type LoadedMindMapFile,
} from "./mindMapFileStore";
import { McpRequestBudgetError } from "./requestBudget";

export const MAX_MCP_RESPONSE_BYTES = 256 * 1024;
const MAX_MCP_TOOL_RESULT_BYTES = 240 * 1024;
const MAX_TITLE_BYTES = 8 * 1024;
const MAX_NODE_TEXT_BYTES = 32 * 1024;
const MAX_BREADCRUMB_ITEM_BYTES = 512;
const MAX_BREADCRUMB_BYTES = 8 * 1024;
const MAX_ERROR_MESSAGE_BYTES = 2 * 1024;
const MAX_TEXT_PREVIEW_NODES = 12;
const MAX_TEXT_PREVIEW_NODE_BYTES = 160;

export type LaniakeaErrorCode =
  | MindMapFileError["code"]
  | MindMapToolError["code"]
  | McpRequestBudgetError["code"]
  | "io_error"
  | "permission_denied";

export type ResponseTruncationReason =
  | AgentViewTruncationReason
  | "response_bytes";

export interface TransportNodeView extends AgentNodeView {
  breadcrumbTruncated: boolean;
  textTruncated: boolean;
}

export interface SnapshotContent
  extends Omit<AgentMapView, "nodes" | "truncationReasons"> {
  status: "ok";
  filePath: string;
  revision: string;
  titleTruncated: boolean;
  nodes: TransportNodeView[];
  returnedNodeCount: number;
  responseLimitBytes: number;
  truncationReasons: ResponseTruncationReason[];
}

export interface SnapshotSource extends AgentMapView {
  filePath: string;
  revision: string;
}

function truncateUtf8(value: string, maximumBytes: number) {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) {
    return { value, truncated: false };
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maximumBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  let end = low;
  if (end > 0 && /[\uD800-\uDBFF]/u.test(value[end - 1])) {
    end -= 1;
  }
  return { value: value.slice(0, end), truncated: true };
}

function compactNode(node: AgentNodeView): TransportNodeView {
  const text = truncateUtf8(node.text, MAX_NODE_TEXT_BYTES);
  const breadcrumb: string[] = [];
  let breadcrumbBytes = 0;
  let breadcrumbTruncated = false;
  for (const part of node.breadcrumb) {
    const compact = truncateUtf8(part, MAX_BREADCRUMB_ITEM_BYTES);
    const bytes = Buffer.byteLength(compact.value, "utf8");
    if (breadcrumbBytes + bytes > MAX_BREADCRUMB_BYTES) {
      breadcrumbTruncated = true;
      break;
    }
    breadcrumb.push(compact.value);
    breadcrumbBytes += bytes;
    breadcrumbTruncated ||= compact.truncated;
  }
  breadcrumbTruncated ||= breadcrumb.length < node.breadcrumb.length;
  return {
    ...node,
    text: text.value,
    textTruncated: text.truncated,
    breadcrumb,
    breadcrumbTruncated,
  };
}

function uniqueReasons(
  reasons: readonly ResponseTruncationReason[],
): ResponseTruncationReason[] {
  return [...new Set(reasons)];
}

function prepareSnapshot(source: SnapshotSource): SnapshotContent {
  const title = truncateUtf8(source.title, MAX_TITLE_BYTES);
  const nodes = source.nodes.map(compactNode);
  const scalarTruncated =
    title.truncated ||
    nodes.some((node) => node.textTruncated || node.breadcrumbTruncated);
  const truncationReasons = uniqueReasons([
    ...source.truncationReasons,
    ...(scalarTruncated ? (["response_bytes"] as const) : []),
  ]);
  return {
    ...source,
    status: "ok",
    title: title.value,
    titleTruncated: title.truncated,
    nodes,
    returnedNodeCount: nodes.length,
    responseLimitBytes: MAX_MCP_RESPONSE_BYTES,
    truncated: source.truncated || scalarTruncated,
    truncationReasons,
  };
}

function renderSnapshot(view: SnapshotContent, action?: string) {
  const lines: string[] = [];
  if (action) lines.push(action);
  lines.push(view.title || "Untitled mind map");
  lines.push(`Revision: ${view.revision}`);
  lines.push(`Returned ${view.returnedNodeCount} of ${view.nodeCount} nodes.`);
  for (const node of view.nodes.slice(0, MAX_TEXT_PREVIEW_NODES)) {
    const preview = truncateUtf8(
      node.text || "(empty)",
      MAX_TEXT_PREVIEW_NODE_BYTES,
    );
    lines.push(
      `${"  ".repeat(Math.min(node.depth, 64))}- ${preview.value}${preview.truncated || node.textTruncated ? "…" : ""} [${node.ref}]${node.subspace ? node.subspace.type === "flow" ? ` · Flow ${node.subspace.nodeCount} steps` : ` · Map ${node.subspace.nodeCount} nodes` : ""}`,
    );
  }
  if (view.nodes.length > MAX_TEXT_PREVIEW_NODES) {
    lines.push("… additional nodes are available in structuredContent.");
  }
  if (view.truncated) {
    lines.push(
      `Result truncated (${view.truncationReasons.join(", ")}); narrow the read by rootRef, depth, node count, or search.`,
    );
  }
  return lines.join("\n");
}

function callToolResult(view: SnapshotContent, action?: string) {
  return {
    content: [
      { type: "text" as const, text: renderSnapshot(view, action) },
    ],
    structuredContent: { ...view },
  };
}

export function serializedToolResultBytes(result: object): number {
  return Buffer.byteLength(JSON.stringify(result), "utf8");
}

export function boundedSnapshotResult(source: SnapshotSource, action?: string) {
  const prepared = prepareSnapshot(source);
  const complete = callToolResult(prepared, action);
  if (serializedToolResultBytes(complete) <= MAX_MCP_TOOL_RESULT_BYTES) {
    return complete;
  }

  let low = 0;
  let high = prepared.nodes.length;
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate: SnapshotContent = {
      ...prepared,
      nodes: prepared.nodes.slice(0, middle),
      returnedNodeCount: middle,
      truncated: true,
      truncationReasons: uniqueReasons([
        ...prepared.truncationReasons,
        "response_bytes",
      ]),
    };
    if (
      serializedToolResultBytes(callToolResult(candidate, action)) <=
      MAX_MCP_TOOL_RESULT_BYTES
    ) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return callToolResult(
    {
      ...prepared,
      nodes: prepared.nodes.slice(0, best),
      returnedNodeCount: best,
      truncated: true,
      truncationReasons: uniqueReasons([
        ...prepared.truncationReasons,
        "response_bytes",
      ]),
    },
    action,
  );
}

function publicError(error: unknown): {
  code: LaniakeaErrorCode;
  message: string;
} {
  if (
    error instanceof MindMapFileError ||
    error instanceof MindMapToolError ||
    error instanceof McpRequestBudgetError
  ) {
    return { code: error.code, message: error.message };
  }
  const systemCode = (error as NodeJS.ErrnoException | undefined)?.code;
  if (systemCode === "EACCES" || systemCode === "EPERM") {
    return {
      code: "permission_denied",
      message: "The operating system denied access to the requested Markdown path.",
    };
  }
  if (systemCode === "ENOENT") {
    return { code: "not_found", message: "The requested Markdown path was not found." };
  }
  if (
    systemCode === "EISDIR" ||
    systemCode === "ENOTDIR" ||
    systemCode === "ELOOP" ||
    systemCode === "ENAMETOOLONG"
  ) {
    return { code: "invalid_path", message: "The requested Markdown path is invalid." };
  }
  return {
    code: "io_error",
    message: "The mind map could not be accessed safely. No write was reported as successful.",
  };
}

export function boundedErrorResult(error: unknown) {
  const mapped = publicError(error);
  const message = truncateUtf8(mapped.message, MAX_ERROR_MESSAGE_BYTES);
  const structuredContent = {
    status: "error" as const,
    error: {
      code: mapped.code,
      message: message.value,
      messageTruncated: message.truncated,
    },
    responseLimitBytes: MAX_MCP_RESPONSE_BYTES,
  };
  return {
    content: [{ type: "text" as const, text: message.value }],
    structuredContent,
    isError: true as const,
  };
}

export function snapshotSource(
  loaded: LoadedMindMapFile,
  view: AgentMapView,
): SnapshotSource {
  return {
    filePath: loaded.filePath,
    revision: loaded.revision,
    ...view,
  };
}
