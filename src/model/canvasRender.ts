import type { LayoutNode } from "../types/mindmap";

export function nodePlaceholder(
  layout: Pick<LayoutNode, "depth" | "rootKind">,
): string {
  if (layout.rootKind === "main") return "中心主题";
  return "输入文本";
}

export function emptyNodeLabel(layout: LayoutNode): string {
  if (layout.rootKind === "main") return "空白中心主题";
  return "空白节点";
}

export function isMarkdownThematicBreak(text: string): boolean {
  const value = text.trim();
  return (
    /^(?:\*\s*){3,}$/.test(value) ||
    /^(?:-\s*){3,}$/.test(value) ||
    /^(?:_\s*){3,}$/.test(value)
  );
}

export function draftForNode(
  nodeId: string,
  editingId: string | null,
  draft: string,
): string {
  return nodeId === editingId ? draft : "";
}

export function nodeIdsRequiredInDom(
  primaryId: string | null,
  editingId: string | null,
  draggingId: string | null,
  dropTargetId: string | null,
): Set<string> {
  return new Set(
    [primaryId, editingId, draggingId, dropTargetId].filter(
      (id): id is string => Boolean(id),
    ),
  );
}
