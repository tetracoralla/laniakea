import type { BranchTone, MindMapDocument } from "../types/mindmap";

// These are existing renderer slots, not document colors. The dark palette
// maps violet to gray teal while the light palette keeps its original values.
const palette: BranchTone[] = ["blue", "emerald", "violet", "amber"];

export function darkBranchTones(
  document: Pick<MindMapDocument, "nodes" | "rootId" | "floatingRoots">,
): Record<string, BranchTone> {
  const tones: Record<string, BranchTone> = Object.create(null);
  const roots = [document.rootId, ...document.floatingRoots.map((root) => root.id)];
  const pending = roots.map((id, index) => ({ id, tone: palette[index % palette.length] }));
  while (pending.length) {
    const { id, tone } = pending.pop()!;
    const node = document.nodes[id];
    if (!node || tones[id]) continue;
    tones[id] = tone;
    const children = node.children.map((childId) => document.nodes[childId]).filter(Boolean);
    const isGroup = (child: typeof node) => child.children.length > 0 || Boolean(child.subspaceId);
    // A single outline wrapper must not force the entire map into one color.
    // Split sibling topic groups; their detail leaves keep the group's color.
    // Ignore collapse/selection/viewport so browsing never recolors the map.
    const split = children.length > 1 &&
      (id === document.rootId || children.filter(isGroup).length > 1);
    let groupIndex = palette.indexOf(tone);
    for (const child of children) {
      const childTone = split && (id === document.rootId || isGroup(child))
        ? palette[groupIndex++ % palette.length] : tone;
      pending.push({ id: child.id, tone: childTone });
    }
  }
  return tones;
}
