import type {
  FlowNode,
  FlowSpace,
  LaniakeaSpace,
  MapSpace,
} from "../types/mindmap";

export interface SubspacePreview {
  accessibleLabel: string;
  lines: string[];
  text: string;
  truncated: boolean;
  typeLabel: "思维图" | "流程";
}

function visibleLabel(text: string, fallback: string): string {
  return text.trim() || fallback;
}

function mapPreview(space: MapSpace): SubspacePreview {
  const childIds = space.nodes[space.rootId]?.children ?? [];
  const lines = childIds.slice(0, 3).map((id) =>
    `-${visibleLabel(space.nodes[id]?.text ?? "", "未命名节点")}`,
  );
  const truncated = childIds.length > 3;
  if (truncated) lines.push("...");
  if (lines.length === 0) lines.push("暂无下级节点");
  const text = lines.join("\n");
  return {
    accessibleLabel: `打开思维图：${lines.join("，")}`,
    lines,
    text,
    truncated,
    typeLabel: "思维图",
  };
}

function isContentNode(node: FlowNode | undefined): node is FlowNode {
  return Boolean(node && node.kind !== "start" && node.kind !== "end");
}

/**
 * Gives a branching flow one stable reading order without pretending that it
 * is linear. A topological prefix follows explicit edges; cycle members keep
 * their source insertion order so malformed or intentionally looping flows
 * still have a deterministic thumbnail.
 */
function orderedContentNodes(space: FlowSpace): FlowNode[] {
  const ids = Object.keys(space.nodes).filter((id) =>
    isContentNode(space.nodes[id]),
  );
  const orderIndex = new Map(ids.map((id, index) => [id, index]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  space.edges.forEach(({ from, to }) => {
    if (!incoming.has(from) || !incoming.has(to)) return;
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
    outgoing.get(from)?.push(to);
  });
  outgoing.forEach((targets) =>
    targets.sort(
      (left, right) =>
        (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0),
    ),
  );

  const queue = ids.filter((id) => incoming.get(id) === 0);
  const ordered: string[] = [];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    ordered.push(current);
    outgoing.get(current)?.forEach((target) => {
      const remaining = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) queue.push(target);
    });
  }
  const included = new Set(ordered);
  ids.forEach((id) => {
    if (!included.has(id)) ordered.push(id);
  });
  return ordered.map((id) => space.nodes[id]);
}

function flowPreview(space: FlowSpace): SubspacePreview {
  const steps = orderedContentNodes(space).map(({ text }) =>
    visibleLabel(text, "未命名步骤"),
  );
  const truncated = steps.length > 4;
  const text = truncated
    ? `${steps.slice(0, 3).join("→")}...→${steps[steps.length - 1]}`
    : steps.length > 0
      ? steps.join("→")
      : "暂无步骤";
  return {
    accessibleLabel: `打开流程：${text}`,
    lines: [text],
    text,
    truncated,
    typeLabel: "流程",
  };
}

export function subspacePreview(space: LaniakeaSpace): SubspacePreview {
  return space.type === "map" ? mapPreview(space) : flowPreview(space);
}

export interface SubspacePreviewTextStyle {
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
}

export type SubspacePreviewTextMeasurer = (
  text: string,
  style: SubspacePreviewTextStyle,
) => number;

const previewTextStyle: SubspacePreviewTextStyle = {
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: 0,
};

/**
 * Sizing prefers a real text measurer (the same one nodes use) and falls back
 * to per-character estimates: CJK counts one unit, latin roughly half.
 */
export function sizeForSubspacePreview(
  space: LaniakeaSpace,
  measureTextWidth?: SubspacePreviewTextMeasurer,
): {
  height: number;
  width: number;
} {
  const preview = subspacePreview(space);
  const lineWidth = (line: string) =>
    measureTextWidth
      ? measureTextWidth(line, previewTextStyle)
      : Array.from(line).reduce(
          (total, character) =>
            total +
            (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(character) ? 13 : 8),
          0,
        );
  if (space.type === "flow") {
    return {
      height: 62,
      width: Math.min(420, Math.max(238, 58 + lineWidth(preview.text))),
    };
  }
  return {
    height: Math.max(62, 26 + preview.lines.length * 20),
    width: Math.min(
      340,
      Math.max(
        220,
        54 +
          preview.lines.reduce(
            (maximum, line) => Math.max(maximum, lineWidth(line)),
            0,
          ),
      ),
    ),
  };
}
