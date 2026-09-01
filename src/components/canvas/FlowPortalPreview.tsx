import { useMemo } from "react";
import { computeFlowLayout } from "../../model/flowLayout";
import type { FlowNode, FlowSpace } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface FlowPortalPreviewProps {
  onOpen: () => void;
  space: FlowSpace;
}

function isContentNode(node: FlowNode): boolean {
  return node.kind !== "start" && node.kind !== "end";
}

function compactLabel(text: string): string {
  const normalized = text.trim() || "输入步骤";
  return Array.from(normalized).length > 9
    ? `${Array.from(normalized).slice(0, 9).join("")}…`
    : normalized;
}

interface MiniNode {
  height: number;
  id: string;
  kind: FlowNode["kind"];
  width: number;
  x: number;
  y: number;
}

function miniTopology(space: FlowSpace): {
  edges: Array<{ from: MiniNode; id: string; to: MiniNode }>;
  nodes: MiniNode[];
} {
  const content = Object.values(space.nodes).filter(isContentNode);
  if (content.length === 0) return { edges: [], nodes: [] };
  const layout = computeFlowLayout(space);
  const laidOut = content.flatMap((node) => {
    const position = layout.nodes[node.id];
    return position ? [{ node, position }] : [];
  });
  const minX = Math.min(...laidOut.map(({ position }) => position.x));
  const minY = Math.min(...laidOut.map(({ position }) => position.y));
  const maxX = Math.max(...laidOut.map(({ position }) => position.x + position.width));
  const maxY = Math.max(...laidOut.map(({ position }) => position.y + position.height));
  const scale = Math.min(
    84 / Math.max(1, maxX - minX),
    38 / Math.max(1, maxY - minY),
  );
  const nodes = laidOut.map(({ node, position }) => ({
    id: node.id,
    kind: node.kind,
    x: 3 + (position.x - minX) * scale,
    y: 3 + (position.y - minY) * scale,
    width: Math.max(5, Math.min(15, position.width * scale)),
    height: Math.max(4, Math.min(10, position.height * scale)),
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = space.edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    return from && to ? [{ from, id: edge.id, to }] : [];
  });
  return { edges, nodes };
}

export function FlowPortalPreview({ onOpen, space }: FlowPortalPreviewProps) {
  const content = useMemo(
    () => Object.values(space.nodes).filter(isContentNode),
    [space.nodes],
  );
  const topology = useMemo(
    () => miniTopology(space),
    [space.edges, space.nodes, space.positions],
  );
  const decisionCount = content.filter(({ kind }) => kind === "decision").length;
  const outgoingCount = new Map<string, number>();
  space.edges.forEach((edge) => {
    if (!space.nodes[edge.from] || !space.nodes[edge.to]) return;
    if (!isContentNode(space.nodes[edge.from]) || !isContentNode(space.nodes[edge.to])) return;
    outgoingCount.set(edge.from, (outgoingCount.get(edge.from) ?? 0) + 1);
  });
  const branchCount = [...outgoingCount.values()].filter((count) => count > 1).length;
  const first = content[0];
  const fullSummary = content.map(({ text }) => text.trim() || "输入步骤").join("，");

  return (
    <button
      aria-label={`打开流程：${fullSummary || "空流程"}`}
      className="flow-portal-preview"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={`进入流程 · ${content.length} 步${decisionCount ? ` · ${decisionCount} 判断` : ""}`}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="flow-portal-preview__topology"
        height="44"
        viewBox="0 0 90 44"
        width="90"
      >
        {topology.edges.map(({ from, id, to }) => {
          const fromX = from.x + from.width / 2;
          const fromY = from.y + from.height / 2;
          const toX = to.x + to.width / 2;
          const toY = to.y + to.height / 2;
          const middleX = (fromX + toX) / 2;
          return (
            <path
              className="flow-portal-preview__edge"
              d={`M ${fromX} ${fromY} H ${middleX} V ${toY} H ${toX}`}
              key={id}
            />
          );
        })}
        {topology.nodes.map((node) => node.kind === "decision" ? (
          <polygon
            className="flow-portal-preview__node is-decision"
            key={node.id}
            points={`${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y + node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y + node.height / 2}`}
          />
        ) : (
          <rect
            className="flow-portal-preview__node"
            height={node.height}
            key={node.id}
            rx={Math.min(2.5, node.height / 3)}
            width={node.width}
            x={node.x}
            y={node.y}
          />
        ))}
      </svg>
      <span className="flow-portal-preview__summary">
        <strong>{first ? compactLabel(first.text) : "空流程"}</strong>
        <span>
          {content.length > 0
            ? `${content.length} 步${decisionCount ? ` · ${decisionCount} 判断` : ""}${branchCount ? ` · ${branchCount} 分支` : ""}`
            : "拖入图形开始"}
        </span>
      </span>
      <Icon name="chevron" size={13} />
    </button>
  );
}
