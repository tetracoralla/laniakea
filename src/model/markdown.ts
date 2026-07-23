import type { MindMapDocument, MindNode } from "../types/mindmap";

export function subtreeToMarkdown(
  document: MindMapDocument,
  rootId = document.rootId,
): string {
  const lines: string[] = [];

  const visit = (id: string, depth: number) => {
    const node = document.nodes[id];
    if (!node) return;
    const safeText = node.text.replace(/\n/g, " ");
    lines.push(`${"  ".repeat(depth)}- ${safeText}`);
    node.children.forEach((childId) => visit(childId, depth + 1));
  };

  visit(rootId, 0);
  return lines.join("\n");
}

function cleanListText(line: string): { depth: number; text: string } | null {
  const match = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/);
  if (!match) return null;
  const spaces = match[1].replace(/\t/g, "  ").length;
  return {
    depth: Math.floor(spaces / 2),
    text: match[2].trim(),
  };
}

export function markdownToDocument(
  markdown: string,
  title = "导入的思维",
): MindMapDocument {
  const parsed = markdown
    .split(/\r?\n/)
    .map(cleanListText)
    .filter((item): item is { depth: number; text: string } => Boolean(item));

  if (parsed.length === 0) {
    throw new Error("没有找到可导入的 Markdown 列表");
  }

  const now = new Date().toISOString();
  const nodes: Record<string, MindNode> = {};
  const stack: string[] = [];

  parsed.forEach((item, index) => {
    const effectiveDepth = index === 0 ? 0 : Math.min(item.depth, stack.length);
    const id = index === 0 ? "root" : `imported-${index}`;
    const parentId = effectiveDepth === 0 ? null : stack[effectiveDepth - 1];

    nodes[id] = {
      id,
      text: item.text,
      parentId,
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };

    if (parentId) nodes[parentId].children.push(id);
    stack[effectiveDepth] = id;
    stack.length = effectiveDepth + 1;
  });

  const rootId = "root";
  if (Object.values(nodes).filter((node) => node.parentId === null).length > 1) {
    const syntheticRoot: MindNode = {
      id: "root-synthetic",
      text: title,
      parentId: null,
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
    Object.values(nodes).forEach((node) => {
      if (node.parentId === null) {
        node.parentId = syntheticRoot.id;
        syntheticRoot.children.push(node.id);
      }
    });
    nodes[syntheticRoot.id] = syntheticRoot;
    return {
      formatVersion: 1,
      title,
      rootId: syntheticRoot.id,
      nodes,
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: now,
    };
  }

  return {
    formatVersion: 1,
    title,
    rootId,
    nodes,
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: now,
  };
}
