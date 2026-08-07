import { createBlankDocument } from "../data/seed";
import { isMindMapDocument, topLevelRootIds } from "../model/document";
import {
  documentToMarkdown,
  parseMarkdownDocument,
  type MarkdownParseResult,
} from "../model/markdown";
import { createNodeId, normalizeNodeText } from "../model/tree";
import type { MindMapDocument, MindNode } from "../types/mindmap";

export const MAX_AGENT_NODES = 10_000;
export const MAX_AGENT_OPERATIONS = 100;
export const MAX_AGENT_DEPTH = 64;
export const MAX_AGENT_TEXT_LENGTH = 20_000;

export interface AgentTreeInput {
  text: string;
  children?: AgentTreeInput[];
}

export interface AgentNodeView {
  ref: string;
  parentRef: string | null;
  depth: number;
  text: string;
  childCount: number;
  breadcrumb: string[];
}

export interface AgentMapView {
  title: string;
  sourceKind: "outline" | "rich";
  canUpdate: boolean;
  nodeCount: number;
  nodes: AgentNodeView[];
  truncated: boolean;
}

export interface AgentViewOptions {
  rootRef?: string;
  maxDepth?: number;
  maxNodes?: number;
}

export type MindMapOperation =
  | { type: "set_title"; title: string }
  | { type: "set_text"; ref: string; text: string }
  | {
      type: "add_child";
      parentRef: string;
      node: AgentTreeInput;
      position?: number;
    }
  | {
      type: "add_sibling";
      siblingRef: string;
      node: AgentTreeInput;
      placement?: "before" | "after";
    }
  | {
      type: "move_subtree";
      ref: string;
      newParentRef: string | null;
      position?: number;
    }
  | { type: "delete_subtree"; ref: string };

export class MindMapToolError extends Error {
  constructor(
    readonly code:
      | "invalid_ref"
      | "invalid_operation"
      | "protected_source"
      | "too_deep"
      | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "MindMapToolError";
  }
}

interface ReferenceIndex {
  idByRef: Map<string, string>;
  refById: Map<string, string>;
}

function buildReferenceIndex(document: MindMapDocument): ReferenceIndex {
  const idByRef = new Map<string, string>();
  const refById = new Map<string, string>();
  const stack = topLevelRootIds(document)
    .map((id, index) => ({ id, ref: `/${index}` }))
    .reverse();

  while (stack.length > 0) {
    const { id, ref } = stack.pop()!;
    const node = document.nodes[id];
    if (!node) continue;
    idByRef.set(ref, id);
    refById.set(id, ref);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({
        id: node.children[index],
        ref: `${ref}/${index}`,
      });
    }
  }

  return { idByRef, refById };
}

function requireRef(index: ReferenceIndex, ref: string): string {
  const id = index.idByRef.get(ref);
  if (!id) {
    throw new MindMapToolError(
      "invalid_ref",
      `Unknown node reference ${ref}. Read the current map again before editing.`,
    );
  }
  return id;
}

function cloneDocument(document: MindMapDocument): MindMapDocument {
  return {
    ...document,
    nodes: Object.fromEntries(
      Object.entries(document.nodes).map(([id, node]) => [
        id,
        { ...node, children: [...node.children] },
      ]),
    ),
    floatingRoots: document.floatingRoots.map((root) => ({ ...root })),
    viewport: { ...document.viewport },
  };
}

function inputNodeCount(node: AgentTreeInput): number {
  const stack = [{ node, depth: 0 }];
  const visited = new WeakSet<object>();
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (
      !current.node ||
      typeof current.node !== "object" ||
      Array.isArray(current.node)
    ) {
      throw new MindMapToolError(
        "invalid_operation",
        "Every Agent-created tree item must be an object with text and optional children.",
      );
    }
    if (visited.has(current.node)) {
      throw new MindMapToolError(
        "invalid_operation",
        "Agent-created tree input must not contain cycles or shared object references.",
      );
    }
    visited.add(current.node);
    if (
      typeof current.node.text !== "string" ||
      current.node.text.length > MAX_AGENT_TEXT_LENGTH
    ) {
      throw new MindMapToolError(
        "invalid_operation",
        `Every Agent-created node needs text no longer than ${MAX_AGENT_TEXT_LENGTH} characters.`,
      );
    }
    if (
      current.node.children !== undefined &&
      !Array.isArray(current.node.children)
    ) {
      throw new MindMapToolError(
        "invalid_operation",
        "Agent-created node children must be an array when provided.",
      );
    }
    if (current.depth > MAX_AGENT_DEPTH) {
      throw new MindMapToolError(
        "too_deep",
        `Agent-created branches may be at most ${MAX_AGENT_DEPTH} levels deep.`,
      );
    }
    count += 1;
    if (count > MAX_AGENT_NODES) {
      throw new MindMapToolError(
        "too_large",
        `A mind map may contain at most ${MAX_AGENT_NODES} Agent-created nodes.`,
      );
    }
    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
  return count;
}

function makeNode(
  text: string,
  parentId: string | null,
  now: string,
): MindNode {
  return {
    id: createNodeId(),
    text: normalizeNodeText(text),
    parentId,
    children: [],
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  };
}

function appendInputTree(
  document: MindMapDocument,
  parentId: string | null,
  input: AgentTreeInput,
  now: string,
): string {
  const node = makeNode(input.text, parentId, now);
  document.nodes[node.id] = node;
  node.children = (input.children ?? []).map((child) =>
    appendInputTree(document, node.id, child, now),
  );
  return node.id;
}

function normalizeInsertPosition(position: number | undefined, length: number) {
  if (position === undefined) return length;
  if (!Number.isInteger(position) || position < 0 || position > length) {
    throw new MindMapToolError(
      "invalid_operation",
      `position must be an integer between 0 and ${length}.`,
    );
  }
  return position;
}

function descendants(document: MindMapDocument, rootId: string): Set<string> {
  const found = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (found.has(id)) continue;
    found.add(id);
    document.nodes[id]?.children.forEach((childId) => stack.push(childId));
  }
  return found;
}

function nextFloatingPosition(document: MindMapDocument) {
  const y = document.floatingRoots.reduce(
    (maximum, root) => Math.max(maximum, root.y),
    -124,
  ) + 220;
  return { x: 1280, y };
}

function removeSubtree(document: MindMapDocument, id: string) {
  const removed = descendants(document, id);
  const current = document.nodes[id];
  if (current.parentId) {
    const parent = document.nodes[current.parentId];
    parent.children = parent.children.filter((childId) => childId !== id);
  } else {
    document.floatingRoots = document.floatingRoots.filter(
      (root) => root.id !== id,
    );
  }
  removed.forEach((nodeId) => delete document.nodes[nodeId]);
}

function touch(document: MindMapDocument, ids: Iterable<string>, now: string) {
  for (const id of ids) {
    const node = document.nodes[id];
    if (node) node.updatedAt = now;
  }
  document.updatedAt = now;
}

export function createAgentMindMap(
  title: string,
  root: AgentTreeInput,
): MindMapDocument {
  inputNodeCount(root);
  const document = createBlankDocument();
  const now = new Date().toISOString();
  const rootNode = document.nodes[document.rootId];
  document.title = title.trim() || "未命名思维";
  rootNode.text = normalizeNodeText(root.text);
  rootNode.updatedAt = now;
  rootNode.children = (root.children ?? []).map((child) =>
    appendInputTree(document, rootNode.id, child, now),
  );
  document.updatedAt = now;
  return document;
}

export function parseAgentMindMap(markdown: string, titleHint: string) {
  return parseMarkdownDocument(markdown, titleHint);
}

export function mindMapToAgentView(
  parsed: MarkdownParseResult,
  options: AgentViewOptions = {},
): AgentMapView {
  const maxDepth = options.maxDepth ?? 8;
  const maxNodes = options.maxNodes ?? 500;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 64) {
    throw new MindMapToolError(
      "invalid_operation",
      "maxDepth must be an integer between 0 and 64.",
    );
  }
  if (
    !Number.isInteger(maxNodes) ||
    maxNodes < 1 ||
    maxNodes > MAX_AGENT_NODES
  ) {
    throw new MindMapToolError(
      "invalid_operation",
      `maxNodes must be an integer between 1 and ${MAX_AGENT_NODES}.`,
    );
  }

  const document = parsed.document;
  const index = buildReferenceIndex(document);
  const startIds = options.rootRef
    ? [requireRef(index, options.rootRef)]
    : topLevelRootIds(document);
  const nodes: AgentNodeView[] = [];
  let truncated = false;
  const stack = startIds
    .map((id) => ({ id, depth: 0, breadcrumb: [] as string[] }))
    .reverse();

  while (stack.length > 0) {
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    const { id, depth, breadcrumb } = stack.pop()!;
    const node = document.nodes[id];
    if (!node) continue;
    const nextBreadcrumb = [...breadcrumb, node.text];
    nodes.push({
      ref: index.refById.get(id)!,
      parentRef: node.parentId ? index.refById.get(node.parentId) ?? null : null,
      depth,
      text: node.text,
      childCount: node.children.length,
      breadcrumb: nextBreadcrumb,
    });
    if (depth >= maxDepth) {
      if (node.children.length > 0) truncated = true;
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({
        id: node.children[index],
        depth: depth + 1,
        breadcrumb: nextBreadcrumb,
      });
    }
  }

  return {
    title: document.title,
    sourceKind: parsed.sourceKind,
    canUpdate: parsed.canOverwriteSource,
    nodeCount: Object.keys(document.nodes).length,
    nodes,
    truncated,
  };
}

export function searchAgentMindMap(
  parsed: MarkdownParseResult,
  query: string,
  maxResults = 100,
): AgentMapView {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    throw new MindMapToolError(
      "invalid_operation",
      "query must contain searchable text.",
    );
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 500) {
    throw new MindMapToolError(
      "invalid_operation",
      "maxResults must be an integer between 1 and 500.",
    );
  }
  const document = parsed.document;
  const index = buildReferenceIndex(document);
  const nodes: AgentNodeView[] = [];
  let matchingCount = 0;
  const stack = topLevelRootIds(document)
    .map((id) => ({ id, depth: 0 }))
    .reverse();

  while (stack.length > 0) {
    const { id, depth } = stack.pop()!;
    const node = document.nodes[id];
    if (!node) continue;
    if (node.text.toLocaleLowerCase().includes(normalizedQuery)) {
      matchingCount += 1;
      if (nodes.length < maxResults) {
        const breadcrumb: string[] = [];
        let cursor: MindNode | undefined = node;
        while (cursor) {
          breadcrumb.push(cursor.text);
          cursor = cursor.parentId
            ? document.nodes[cursor.parentId]
            : undefined;
        }
        nodes.push({
          ref: index.refById.get(id)!,
          parentRef: node.parentId
            ? index.refById.get(node.parentId) ?? null
            : null,
          depth,
          text: node.text,
          childCount: node.children.length,
          breadcrumb: breadcrumb.reverse(),
        });
      }
    }
    for (let childIndex = node.children.length - 1; childIndex >= 0; childIndex -= 1) {
      stack.push({ id: node.children[childIndex], depth: depth + 1 });
    }
  }

  return {
    title: document.title,
    sourceKind: parsed.sourceKind,
    canUpdate: parsed.canOverwriteSource,
    nodeCount: Object.keys(document.nodes).length,
    nodes,
    truncated: matchingCount > maxResults,
  };
}

export function applyMindMapOperations(
  parsed: MarkdownParseResult,
  operations: readonly MindMapOperation[],
): { document: MindMapDocument; markdown: string } {
  if (!parsed.canOverwriteSource) {
    throw new MindMapToolError(
      "protected_source",
      "This Markdown contains rich content that Laniakea cannot rewrite losslessly. Create a new mind map instead of updating the source file.",
    );
  }
  if (operations.length === 0 || operations.length > MAX_AGENT_OPERATIONS) {
    throw new MindMapToolError(
      "invalid_operation",
      `operations must contain between 1 and ${MAX_AGENT_OPERATIONS} items.`,
    );
  }

  const document = cloneDocument(parsed.document);
  const initialIndex = buildReferenceIndex(document);
  const now = new Date().toISOString();

  for (const operation of operations) {
    if (operation.type === "set_title") {
      document.title = operation.title.trim() || "未命名思维";
      document.updatedAt = now;
      continue;
    }

    if (operation.type === "set_text") {
      const id = requireRef(initialIndex, operation.ref);
      const node = document.nodes[id];
      if (!node) {
        throw new MindMapToolError(
          "invalid_operation",
          `Node ${operation.ref} was removed by an earlier operation.`,
        );
      }
      node.text = normalizeNodeText(operation.text);
      touch(document, [id], now);
      continue;
    }

    if (operation.type === "add_child") {
      const parentId = requireRef(initialIndex, operation.parentRef);
      const parent = document.nodes[parentId];
      if (!parent) {
        throw new MindMapToolError(
          "invalid_operation",
          `Parent ${operation.parentRef} was removed by an earlier operation.`,
        );
      }
      const addedCount = inputNodeCount(operation.node);
      if (Object.keys(document.nodes).length + addedCount > MAX_AGENT_NODES) {
        throw new MindMapToolError(
          "too_large",
          `A mind map may contain at most ${MAX_AGENT_NODES} nodes.`,
        );
      }
      const insertAt = normalizeInsertPosition(
        operation.position,
        parent.children.length,
      );
      const createdId = appendInputTree(
        document,
        parentId,
        operation.node,
        now,
      );
      parent.children.splice(insertAt, 0, createdId);
      touch(document, [parentId], now);
      continue;
    }

    if (operation.type === "add_sibling") {
      const siblingId = requireRef(initialIndex, operation.siblingRef);
      const sibling = document.nodes[siblingId];
      if (!sibling) {
        throw new MindMapToolError(
          "invalid_operation",
          `Node ${operation.siblingRef} was removed by an earlier operation.`,
        );
      }
      const addedCount = inputNodeCount(operation.node);
      if (Object.keys(document.nodes).length + addedCount > MAX_AGENT_NODES) {
        throw new MindMapToolError(
          "too_large",
          `A mind map may contain at most ${MAX_AGENT_NODES} nodes.`,
        );
      }
      if (!sibling.parentId) {
        if (
          siblingId === document.rootId &&
          operation.placement === "before"
        ) {
          throw new MindMapToolError(
            "invalid_operation",
            "The main root must remain the first top-level branch.",
          );
        }
        const siblingIndex = document.floatingRoots.findIndex(
          (root) => root.id === siblingId,
        );
        const insertAt =
          siblingId === document.rootId
            ? 0
            : siblingIndex + (operation.placement === "before" ? 0 : 1);
        const createdId = appendInputTree(document, null, operation.node, now);
        document.floatingRoots.splice(insertAt, 0, {
          id: createdId,
          ...nextFloatingPosition(document),
        });
        touch(document, [], now);
        continue;
      }
      const parent = document.nodes[sibling.parentId];
      if (!parent) {
        throw new MindMapToolError(
          "invalid_operation",
          "The sibling parent was removed by an earlier operation.",
        );
      }
      const siblingIndex = parent.children.indexOf(siblingId);
      const createdId = appendInputTree(
        document,
        parent.id,
        operation.node,
        now,
      );
      parent.children.splice(
        siblingIndex + (operation.placement === "before" ? 0 : 1),
        0,
        createdId,
      );
      touch(document, [parent.id], now);
      continue;
    }

    if (operation.type === "move_subtree") {
      const id = requireRef(initialIndex, operation.ref);
      const node = document.nodes[id];
      if (!node) {
        throw new MindMapToolError(
          "invalid_operation",
          "A moved node was removed by an earlier operation.",
        );
      }
      if (id === document.rootId) {
        throw new MindMapToolError(
          "invalid_operation",
          "The main root cannot be moved.",
        );
      }
      const oldParentId = node.parentId;
      const previousFloatingPosition = document.floatingRoots.find(
        (root) => root.id === id,
      );
      if (oldParentId) {
        const oldParent = document.nodes[oldParentId];
        oldParent.children = oldParent.children.filter(
          (childId) => childId !== id,
        );
      } else {
        document.floatingRoots = document.floatingRoots.filter(
          (root) => root.id !== id,
        );
      }

      if (operation.newParentRef === null) {
        const insertAt = normalizeInsertPosition(
          operation.position,
          document.floatingRoots.length,
        );
        document.floatingRoots.splice(insertAt, 0, {
          id,
          ...(previousFloatingPosition ?? nextFloatingPosition(document)),
        });
        node.parentId = null;
        touch(document, [id, ...(oldParentId ? [oldParentId] : [])], now);
        continue;
      }

      const newParentId = requireRef(initialIndex, operation.newParentRef);
      const newParent = document.nodes[newParentId];
      if (!newParent) {
        throw new MindMapToolError(
          "invalid_operation",
          "The move destination was removed by an earlier operation.",
        );
      }
      if (id === newParentId) {
        throw new MindMapToolError(
          "invalid_operation",
          "A node cannot contain itself.",
        );
      }
      if (descendants(document, id).has(newParentId)) {
        throw new MindMapToolError(
          "invalid_operation",
          "A branch cannot be moved below one of its descendants.",
        );
      }
      const insertAt = normalizeInsertPosition(
        operation.position,
        newParent.children.length,
      );
      newParent.children.splice(insertAt, 0, id);
      node.parentId = newParentId;
      touch(
        document,
        [id, newParentId, ...(oldParentId ? [oldParentId] : [])],
        now,
      );
      continue;
    }

    const id = requireRef(initialIndex, operation.ref);
    if (id === document.rootId) {
      throw new MindMapToolError(
        "invalid_operation",
        "The main root cannot be deleted.",
      );
    }
    if (!document.nodes[id]) {
      throw new MindMapToolError(
        "invalid_operation",
        `Node ${operation.ref} was removed by an earlier operation.`,
      );
    }
    const parentId = document.nodes[id].parentId;
    removeSubtree(document, id);
    touch(document, parentId ? [parentId] : [], now);
  }

  if (!isMindMapDocument(document)) {
    throw new MindMapToolError(
      "invalid_operation",
      "The requested operations would create an invalid mind-map structure.",
    );
  }
  return { document, markdown: documentToMarkdown(document) };
}
