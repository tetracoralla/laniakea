import { useMemo } from "react";
import type { FlowNode, FlowSpace } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface FlowPortalPreviewProps {
  onOpen: () => void;
  space: FlowSpace;
}

function orderedContentNodes(space: FlowSpace): FlowNode[] {
  const contentIds = Object.keys(space.nodes).filter((id) =>
    space.nodes[id].kind !== "start" && space.nodes[id].kind !== "end",
  );
  const contentSet = new Set(contentIds);
  const incoming = new Map(contentIds.map((id) => [id, 0]));
  const outgoing = new Map(contentIds.map((id) => [id, [] as string[]]));
  space.edges.forEach((edge) => {
    if (!contentSet.has(edge.from) || !contentSet.has(edge.to)) return;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });
  const pending = contentIds
    .filter((id) => incoming.get(id) === 0)
    .sort((left, right) => left.localeCompare(right));
  const ordered: string[] = [];
  while (pending.length > 0) {
    const current = pending.shift()!;
    ordered.push(current);
    (outgoing.get(current) ?? []).forEach((target) => {
      const next = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, next);
      if (next === 0) pending.push(target);
    });
  }
  contentIds.forEach((id) => {
    if (!ordered.includes(id)) ordered.push(id);
  });
  return ordered.map((id) => space.nodes[id]);
}

function compactLabel(text: string): string {
  const normalized = text.trim() || "输入步骤";
  return Array.from(normalized).length > 6
    ? `${Array.from(normalized).slice(0, 6).join("")}…`
    : normalized;
}

function isContentNode(node: FlowNode): boolean {
  return node.kind !== "start" && node.kind !== "end";
}

// 只沿真实出边走一条链：预览里的箭头必须对应画布上真实存在的连线，
// 互不相连的节点不允许被顺序符号串起来。
function contentChain(space: FlowSpace, ordered: FlowNode[]): FlowNode[] {
  if (ordered.length === 0) return [];
  const firstOutgoing = new Map<string, string>();
  space.edges.forEach((edge) => {
    if (
      !firstOutgoing.has(edge.from) &&
      space.nodes[edge.from] &&
      space.nodes[edge.to] &&
      isContentNode(space.nodes[edge.from]) &&
      isContentNode(space.nodes[edge.to])
    ) {
      firstOutgoing.set(edge.from, edge.to);
    }
  });
  const chain: FlowNode[] = [];
  const visited = new Set<string>();
  let current = ordered[0].id;
  while (space.nodes[current] && !visited.has(current)) {
    visited.add(current);
    chain.push(space.nodes[current]);
    const next = firstOutgoing.get(current);
    if (!next) break;
    current = next;
  }
  return chain;
}

export function FlowPortalPreview({ onOpen, space }: FlowPortalPreviewProps) {
  const nodes = useMemo(() => orderedContentNodes(space), [space.edges, space.nodes]);
  const chain = useMemo(() => contentChain(space, nodes), [space.edges, space.nodes]);
  const connected = chain.length >= 2;
  const displayItems = connected ? chain : nodes;
  const separator = connected ? "→" : "·";
  const visible = displayItems.length <= 3
    ? displayItems
    : [displayItems[0], displayItems[displayItems.length - 1]];
  const decisionCount = nodes.filter(({ kind }) => kind === "decision").length;
  const fullSummary = nodes.map(({ text }) => text.trim() || "输入步骤").join("，");

  return (
    <button
      aria-label={`打开流程：${fullSummary || "空流程"}`}
      className="flow-portal-preview"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={`进入流程 · ${nodes.length} 步${decisionCount ? ` · ${decisionCount} 判断` : ""}`}
      type="button"
    >
      <span aria-hidden="true" className="flow-portal-preview__sequence">
        {visible.map((node, index) => (
          <span className="flow-portal-preview__item" key={node.id}>
            {index > 0 && (
              <span className="flow-portal-preview__arrow">
                {displayItems.length > 3 && index === 1 ? "…" : separator}
              </span>
            )}
            <span
              className={`flow-portal-preview__shape flow-portal-preview__shape--${node.kind}`}
            >
              {compactLabel(node.text)}
            </span>
          </span>
        ))}
      </span>
      <span className="flow-portal-preview__meta">
        {nodes.length} 步
        <Icon name="chevron" size={11} />
      </span>
    </button>
  );
}
