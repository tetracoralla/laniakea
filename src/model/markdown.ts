import type {
  Code,
  Heading,
  List,
  ListItem,
  Paragraph,
  Root,
  RootContent,
} from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { createBlankDocument } from "../data/seed";
import {
  isMindMapDocument,
  resolveProvisionalDocumentTitle,
  topLevelRootIds,
} from "./document";
import type {
  FlowEdge,
  FlowNode,
  FlowSpace,
  LaniakeaSpace,
  MapSpace,
  MindMapDocument,
  MindNode,
} from "../types/mindmap";
import { documentSpaces } from "./spaces";

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: "-",
    fences: true,
    listItemIndent: "one",
  });

const nodeTextLinesCache = new WeakMap<
  MindNode,
  { text: string; lines: string[] }
>();

export interface MarkdownParseResult {
  document: MindMapDocument;
  /**
   * Only the deliberately small outline subset can be rewritten in place.
   * Rich Markdown is rendered, but the source stays untouched until the user
   * chooses a new Markdown file.
   */
  canOverwriteSource: boolean;
  sourceKind: "outline" | "rich";
}

interface ParsedIndentedLine {
  indent: number;
  text: string;
}

interface DocumentBuilder {
  nodes: Record<string, MindNode>;
  nextId: number;
  now: string;
}

interface PortableFlowSpace {
  id: string;
  type: "flow";
  nodes: Record<string, FlowNode>;
  edges: FlowEdge[];
}

interface PortableMapSpace {
  id: string;
  type: "map";
  rootId: string;
  nodes: Record<string, MindNode>;
  floatingRoots: MindMapDocument["floatingRoots"];
}

interface PortableSpacePortal {
  anchorRef: string;
  space: PortableFlowSpace | PortableMapSpace;
}

interface PortableSpaceBundle {
  version: 1 | 2;
  portals: PortableSpacePortal[];
}

function nodeReferenceMaps(document: MindMapDocument): {
  idByRef: Map<string, string>;
  refById: Map<string, string>;
} {
  const idByRef = new Map<string, string>();
  const refById = new Map<string, string>();
  const pending = topLevelRootIds(document)
    .map((id, index) => ({ id, ref: `/${index}` }))
    .reverse();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const node = document.nodes[current.id];
    if (!node) continue;
    idByRef.set(current.ref, current.id);
    refById.set(current.id, current.ref);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        id: node.children[index],
        ref: `${current.ref}/${index}`,
      });
    }
  }
  Object.values(documentSpaces(document))
    .filter((space): space is MapSpace => space.type === "map")
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((space) => {
      const localPending = [
        space.rootId,
        ...space.floatingRoots.map(({ id }) => id),
      ]
        .map((id, index) => ({ id, ref: `space:${space.id}/${index}` }))
        .reverse();
      while (localPending.length > 0) {
        const current = localPending.pop();
        if (!current) continue;
        const node = space.nodes[current.id];
        if (!node) continue;
        idByRef.set(current.ref, current.id);
        refById.set(current.id, current.ref);
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          localPending.push({
            id: node.children[index],
            ref: `${current.ref}/${index}`,
          });
        }
      }
    });
  return { idByRef, refById };
}

function portableMapNodes(
  nodes: Record<string, MindNode>,
): Record<string, MindNode> {
  return Object.fromEntries(
    Object.entries(nodes).map(([nodeId, node]) => {
      const { subspaceId: _subspaceId, ...portableNode } = node;
      return [nodeId, portableNode];
    }),
  );
}

function portableSpaceBundle(
  document: MindMapDocument,
): PortableSpaceBundle | null {
  const { refById } = nodeReferenceMaps(document);
  const portals = Object.values(documentSpaces(document))
    .map((space): PortableSpacePortal | null => {
      const anchorRef = refById.get(space.anchorNodeId);
      if (!anchorRef) return null;
      return {
        anchorRef,
        space: space.type === "flow"
          ? {
              id: space.id,
              type: "flow",
              nodes: space.nodes,
              edges: space.edges,
            }
          : {
              id: space.id,
              type: "map",
              rootId: space.rootId,
              nodes: portableMapNodes(space.nodes),
              floatingRoots: space.floatingRoots,
            },
      };
    })
    .filter((portal): portal is PortableSpacePortal => Boolean(portal))
    .sort((left, right) => left.anchorRef.localeCompare(right.anchorRef));
  return portals.length > 0
    ? {
        version: portals.some(({ space }) => space.type === "map") ? 2 : 1,
        portals,
      }
    : null;
}

function parsePortableSpaceBundle(code: Code): PortableSpaceBundle | null {
  try {
    const candidate = JSON.parse(code.value) as Partial<PortableSpaceBundle>;
    if (
      (candidate.version !== 1 && candidate.version !== 2) ||
      !Array.isArray(candidate.portals) ||
      candidate.portals.some(
        (portal) =>
          !portal ||
          typeof portal !== "object" ||
          typeof portal.anchorRef !== "string" ||
          !portal.space ||
          typeof portal.space !== "object" ||
          (candidate.version === 1 && portal.space.type !== "flow"),
      )
    ) {
      return null;
    }
    return candidate as PortableSpaceBundle;
  } catch {
    return null;
  }
}

function hydratePortableSpaces(
  document: MindMapDocument,
  bundle: PortableSpaceBundle,
): MindMapDocument | null {
  const nodes = { ...document.nodes };
  const spaces: Record<string, LaniakeaSpace> = {};
  const now = new Date().toISOString();
  for (const portal of bundle.portals) {
    if (spaces[portal.space.id]) return null;
    spaces[portal.space.id] = portal.space.type === "flow"
      ? {
          ...portal.space,
          anchorNodeId: "",
          viewport: { x: 96, y: 72, zoom: 1 },
          updatedAt: now,
        }
      : {
          ...portal.space,
          anchorNodeId: "",
          nodes: Object.fromEntries(
            Object.entries(portal.space.nodes).map(([nodeId, node]) => [
              nodeId,
              { ...node, children: [...node.children] },
            ]),
          ),
          viewport: { x: 96, y: 72, zoom: 1 },
          updatedAt: now,
        };
  }

  const candidate: MindMapDocument = { ...document, nodes, spaces };
  const { idByRef } = nodeReferenceMaps(candidate);
  const mutableNodeRecord = (nodeId: string): Record<string, MindNode> | null => {
    if (nodes[nodeId]) return nodes;
    for (const space of Object.values(spaces)) {
      if (space.type === "map" && space.nodes[nodeId]) return space.nodes;
    }
    return null;
  };
  for (const portal of bundle.portals) {
    const anchorNodeId = idByRef.get(portal.anchorRef);
    const nodeRecord = anchorNodeId ? mutableNodeRecord(anchorNodeId) : null;
    const anchor = anchorNodeId && nodeRecord ? nodeRecord[anchorNodeId] : null;
    const space = spaces[portal.space.id];
    if (!anchorNodeId || !anchor || anchor.subspaceId || !space) return null;
    nodeRecord![anchorNodeId] = {
      ...anchor,
      subspaceId: portal.space.id,
    };
    spaces[portal.space.id] = { ...space, anchorNodeId };
  }
  return isMindMapDocument(candidate) ? candidate : null;
}

function createBuilder(): DocumentBuilder {
  return {
    nodes: {},
    nextId: 0,
    now: new Date().toISOString(),
  };
}

function addNode(
  builder: DocumentBuilder,
  text: string,
  parentId: string | null,
  preferredId?: string,
): string {
  const generatedId = `imported-${builder.nextId++}`;
  const id = preferredId ?? generatedId;
  builder.nodes[id] = {
    id,
    text: text.trim(),
    parentId,
    children: [],
    collapsed: false,
    createdAt: builder.now,
    updatedAt: builder.now,
  };
  if (parentId) builder.nodes[parentId]?.children.push(id);
  return id;
}

function finishDocument(
  builder: DocumentBuilder,
  rootId: string,
  title: string,
  floatingRootIds: readonly string[] = [],
): MindMapDocument {
  return {
    formatVersion: 1,
    title: title.trim() || builder.nodes[rootId]?.text || "未命名思维",
    rootId,
    nodes: builder.nodes,
    floatingRoots: floatingRootIds.map((id, index) => ({
      id,
      x: 1280,
      y: 96 + index * 220,
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: builder.now,
  };
}

function stringifyPlainText(value: string): string {
  const root: Root = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            value: value.replace(/\r\n?/g, "\n"),
          },
        ],
      },
    ],
  };
  return markdownProcessor.stringify(root).trimEnd();
}

function safeLineText(value: string): string[] {
  const lines = stringifyPlainText(value).split("\n");
  return lines.length > 0 ? lines : [""];
}

function safeNodeText(node: MindNode): string[] {
  const cached = nodeTextLinesCache.get(node);
  if (cached?.text === node.text) return cached.lines;
  const lines = safeLineText(node.text);
  nodeTextLinesCache.set(node, { text: node.text, lines });
  return lines;
}

export function subtreeToMarkdown(
  document: MindMapDocument,
  rootId = document.rootId,
): string {
  const lines: string[] = [];
  const pending = [{ id: rootId, depth: 0 }];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) continue;
    const { id, depth } = frame;
    const node = document.nodes[id];
    if (!node) continue;
    const indent = "  ".repeat(depth);
    const textLines = safeNodeText(node);
    lines.push(`${indent}- ${textLines[0]}`);
    textLines.slice(1).forEach((line) => {
      lines.push(`${indent}  ${line}`);
    });
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ id: node.children[index], depth: depth + 1 });
    }
  }
  return lines.join("\n");
}

export function documentToMarkdown(document: MindMapDocument): string {
  const title = document.title.replace(/\r?\n/g, " ").trim() || "未命名思维";
  const heading = markdownProcessor
    .stringify({
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: title }],
        },
      ],
    })
    .trimEnd();
  const outline = topLevelRootIds(document)
    .map((id) => subtreeToMarkdown(document, id))
    .filter(Boolean)
    .join("\n");
  const bundle = portableSpaceBundle(document);
  if (!bundle) return `${heading}\n\n${outline}\n`;
  return `${heading}\n\n${outline}\n\n~~~laniakea\n${JSON.stringify(bundle, null, 2)}\n~~~\n`;
}

function isPlainParagraph(node: RootContent | undefined): node is Paragraph {
  return (
    node?.type === "paragraph" &&
    node.children.every((child) => child.type === "text" || (
      child.type === "link" && child.position === undefined &&
      child.children.every((part) => part.type === "text") &&
      (child.url === toString(child) || child.url === `mailto:${toString(child)}` ||
        child.url === `http://${toString(child)}`)
    ))
  );
}

function isSafeOutlineList(list: List): boolean {
  const pending = [list];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const item of current.children) {
      if (item.checked !== null && item.checked !== undefined) return false;
      const first = item.children[0];
      if (!first) continue;
      const structuralChildren =
        first.type === "list" ? item.children : item.children.slice(1);
      if (first.type !== "list" && !isPlainParagraph(first)) return false;
      for (const child of structuralChildren) {
        if (child.type !== "list") return false;
        pending.push(child);
      }
    }
  }
  return true;
}

function outlineParts(root: Root): {
  list: List;
  title: string | null;
} | null {
  const children = root.children;
  if (children.length === 1 && children[0].type === "list") {
    return isSafeOutlineList(children[0])
      ? { list: children[0], title: null }
      : null;
  }
  if (
    children.length === 2 &&
    children[0].type === "heading" &&
    children[0].depth === 1 &&
    children[0].children.every((child) => child.type === "text") &&
    children[1].type === "list" &&
    isSafeOutlineList(children[1])
  ) {
    return {
      list: children[1],
      title: toString(children[0]).trim(),
    };
  }
  return null;
}

function listItemText(item: ListItem): string {
  const first = item.children[0];
  if (!first || first.type === "list") return "";
  const text =
    first.type === "thematicBreak"
      ? blockLabel(first)
      : first.type === "paragraph" && !isPlainParagraph(first)
      ? stringifyBlock(first)
      : toString(first);
  const taskPrefix =
    item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
  return `${taskPrefix}${text}`.trim();
}

function appendListItem(
  builder: DocumentBuilder,
  item: ListItem,
  parentId: string | null,
  preferredId?: string,
): string {
  const id = addNode(builder, listItemText(item), parentId, preferredId);
  type AppendTask =
    | { item: ListItem; parentId: string; type: "item" }
    | { block: RootContent; parentId: string; type: "block" };
  const pending: AppendTask[] = [];
  const enqueueChildren = (current: ListItem, currentId: string) => {
    const first = current.children[0];
    const structuralChildren =
      first?.type === "list" ? current.children : current.children.slice(1);
    const tasks: AppendTask[] = [];
    structuralChildren.forEach((child) => {
      if (child.type === "list") {
        child.children.forEach((nested) => {
          tasks.push({ type: "item", item: nested, parentId: currentId });
        });
      } else {
        tasks.push({ type: "block", block: child, parentId: currentId });
      }
    });
    for (let index = tasks.length - 1; index >= 0; index -= 1) {
      pending.push(tasks[index]);
    }
  };
  enqueueChildren(item, id);
  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) continue;
    if (task.type === "block") {
      addNode(builder, blockLabel(task.block), task.parentId);
      continue;
    }
    const childId = addNode(
      builder,
      listItemText(task.item),
      task.parentId,
    );
    enqueueChildren(task.item, childId);
  }
  return id;
}

function documentFromOutlineList(
  list: List,
  titleHint: string,
  markdownTitle: string | null,
): MindMapDocument {
  const builder = createBuilder();
  const [first, ...remaining] = list.children;
  const rootId = appendListItem(builder, first, null, "root");
  const floatingRootIds = remaining.map((item) =>
    appendListItem(builder, item, null),
  );
  return resolveProvisionalDocumentTitle(
    finishDocument(
      builder,
      rootId,
      markdownTitle ?? titleHint ?? builder.nodes[rootId].text,
      floatingRootIds,
    ),
    titleHint,
  );
}

function stringifyBlock(node: RootContent): string {
  try {
    return markdownProcessor
      .stringify({ type: "root", children: [node] })
      .trim();
  } catch {
    return toString(node).trim();
  }
}

function blockLabel(node: RootContent): string {
  if (node.type === "thematicBreak") return "***";
  if (node.type === "paragraph" && isPlainParagraph(node)) {
    return toString(node).trim();
  }
  // Anything that does not map cleanly to a mind-map structure stays as a
  // normal editable node containing its Markdown. It needs no separate panel
  // or lifecycle: users can edit, move, or delete it like any other node.
  return stringifyBlock(node) || toString(node).trim() || node.type;
}

function firstHeading(root: Root): {
  heading: Heading;
  index: number;
} | null {
  const index = root.children.findIndex(
    (child) => child.type === "heading",
  );
  if (index < 0) return null;
  return {
    heading: root.children[index] as Heading,
    index,
  };
}

function appendRichList(
  builder: DocumentBuilder,
  list: List,
  parentId: string,
): void {
  list.children.forEach((item) => appendListItem(builder, item, parentId));
}

function documentFromRichMarkdown(
  root: Root,
  titleHint: string,
): MindMapDocument {
  const builder = createBuilder();
  const first = firstHeading(root);
  const rootText = first ? toString(first.heading) : titleHint;
  const rootId = addNode(
    builder,
    rootText || "导入的思维",
    null,
    "root",
  );
  const headingStack = new Map<number, string>();
  if (first) headingStack.set(first.heading.depth, rootId);
  let currentSectionId = rootId;

  root.children.forEach((child, index) => {
    if (first && index === first.index) return;
    if (child.type === "heading") {
      let parentId = rootId;
      for (let depth = child.depth - 1; depth >= 1; depth -= 1) {
        const candidate = headingStack.get(depth);
        if (candidate) {
          parentId = candidate;
          break;
        }
      }
      const id = addNode(builder, toString(child), parentId);
      headingStack.set(child.depth, id);
      [...headingStack.keys()]
        .filter((depth) => depth > child.depth)
        .forEach((depth) => headingStack.delete(depth));
      currentSectionId = id;
      return;
    }
    if (child.type === "list") {
      appendRichList(builder, child, currentSectionId);
      return;
    }
    addNode(builder, blockLabel(child), currentSectionId);
  });

  return resolveProvisionalDocumentTitle(
    finishDocument(
      builder,
      rootId,
      first ? toString(first.heading) : titleHint,
    ),
    titleHint,
  );
}

function cleanIndentedText(line: string): ParsedIndentedLine | null {
  const match = line.match(/^(\s*)(\S.*)$/);
  if (!match) return null;
  return {
    indent: match[1].replace(/\t/g, "    ").length,
    text: match[2].trim(),
  };
}

function indentedTextItems(
  value: string,
): Array<{ depth: number; text: string }> | null {
  const lines = value
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const parsed = lines
    .map(cleanIndentedText)
    .filter((item): item is ParsedIndentedLine => Boolean(item));
  if (
    parsed.length < 2 ||
    !parsed.some((item) => item.indent > parsed[0].indent)
  ) {
    return null;
  }

  const levels = [parsed[0].indent];
  return parsed.map((item, index) => {
    if (index === 0) return { depth: 0, text: item.text };
    const exactDepth = levels.indexOf(item.indent);
    if (exactDepth >= 0) {
      levels.length = exactDepth + 1;
      return { depth: exactDepth, text: item.text };
    }
    let parentDepth = -1;
    levels.forEach((indent, depth) => {
      if (indent < item.indent) parentDepth = depth;
    });
    const depth = Math.max(0, parentDepth + 1);
    levels[depth] = item.indent;
    levels.length = depth + 1;
    return { depth, text: item.text };
  });
}

function documentFromIndentedText(
  items: Array<{ depth: number; text: string }>,
  title: string,
): MindMapDocument {
  const builder = createBuilder();
  const stack: string[] = [];
  const rootIds: string[] = [];
  items.forEach((item, index) => {
    const depth = index === 0 ? 0 : Math.min(item.depth, stack.length);
    const parentId = depth === 0 ? null : stack[depth - 1];
    const id = addNode(
      builder,
      item.text,
      parentId,
      index === 0 ? "root" : undefined,
    );
    if (parentId === null) rootIds.push(id);
    stack[depth] = id;
    stack.length = depth + 1;
  });
  return finishDocument(builder, "root", title, rootIds.slice(1));
}

export function parseMarkdownDocument(
  markdown: string,
  title = "导入的思维",
): MarkdownParseResult {
  if (!markdown.trim()) {
    const document = resolveProvisionalDocumentTitle(
      { ...createBlankDocument(), title },
      title,
    );
    return {
      document,
      canOverwriteSource: true,
      sourceKind: "outline",
    };
  }

  const indented = indentedTextItems(markdown);
  if (indented && !/^\s*(?:[-*+]|\d+\.)\s+/m.test(markdown)) {
    return {
      document: documentFromIndentedText(indented, title),
      canOverwriteSource: false,
      sourceKind: "rich",
    };
  }

  const root = markdownProcessor.parse(markdown) as Root;
  const metadataBlocks = root.children.filter(
    (child): child is Code => child.type === "code" && child.lang === "laniakea",
  );
  const bundle =
    metadataBlocks.length === 1
      ? parsePortableSpaceBundle(metadataBlocks[0])
      : null;
  const outlineRoot: Root = {
    ...root,
    children: root.children.filter((child) => !metadataBlocks.includes(child as Code)),
  };
  const outline = outlineParts(outlineRoot);
  if (outline) {
    const outlineDocument = documentFromOutlineList(
      outline.list,
      title,
      outline.title,
    );
    const hydrated = bundle
      ? hydratePortableSpaces(outlineDocument, bundle)
      : null;
    if (metadataBlocks.length > 0 && !hydrated) {
      return {
        document: documentFromRichMarkdown(root, title),
        canOverwriteSource: false,
        sourceKind: "rich",
      };
    }
    return {
      document: hydrated ?? outlineDocument,
      canOverwriteSource: true,
      sourceKind: "outline",
    };
  }

  return {
    document: documentFromRichMarkdown(root, title),
    canOverwriteSource: false,
    sourceKind: "rich",
  };
}

export function markdownToDocument(
  markdown: string,
  title = "导入的思维",
): MindMapDocument {
  return parseMarkdownDocument(markdown, title).document;
}
