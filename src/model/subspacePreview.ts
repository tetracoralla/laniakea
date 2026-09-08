import { t } from "../i18n/locale";
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
  typeLabel: string;
}

function visibleLabel(text: string, fallback: string): string {
  return text.trim() || fallback;
}

function mapPreview(space: MapSpace): SubspacePreview {
  const childIds = space.nodes[space.rootId]?.children ?? [];
  const lines = childIds.slice(0, 3).map((id) =>
    `-${visibleLabel(space.nodes[id]?.text ?? "", t("未命名节点"))}`,
  );
  if (childIds.length > 3) lines.push("...");
  if (lines.length === 0) lines.push(t("暂无下级节点"));
  const text = lines.join("\n");
  return {
    accessibleLabel: t("打开思维图：{0}", lines.join("，")),
    lines,
    text,
    typeLabel: t("思维图"),
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
  const nodes = orderedContentNodes(space);
  const steps = nodes.map(({ text }) => visibleLabel(text, t("未命名步骤")));
  const separator = (index: number) => space.edges.some(({ from, to }) =>
    from === nodes[index - 1]?.id && to === nodes[index]?.id,
  ) ? "→" : " · ";
  const joinSteps = (count: number) => steps.slice(0, count)
    .map((text, index) => `${index ? separator(index) : ""}${text}`).join("");
  const truncated = steps.length > 4;
  const text = truncated
    ? `${joinSteps(3)}...${separator(steps.length - 1)}${steps[steps.length - 1]}`
    : steps.length > 0
      ? joinSteps(steps.length)
      : t("暂无步骤");
  return {
    accessibleLabel: t("打开流程：{0}", text),
    lines: [text],
    text,
    typeLabel: t("流程"),
  };
}

export function subspacePreview(space: LaniakeaSpace): SubspacePreview {
  return space.type === "map" ? mapPreview(space) : flowPreview(space);
}
