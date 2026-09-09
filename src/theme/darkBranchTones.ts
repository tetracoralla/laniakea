import type { BranchTone, MindMapDocument } from "../types/mindmap";

// These are existing renderer slots, not document colors. The dark palette
// maps violet to gray teal while the light palette keeps its original values.
const palette: BranchTone[] = ["blue", "emerald", "violet", "amber"];

export function darkBranchTones(
  document: Pick<MindMapDocument, "nodes" | "rootId" | "floatingRoots">,
): Record<string, BranchTone> {
  const tones: Record<string, BranchTone> = Object.create(null);
  const roots = [document.rootId, ...document.floatingRoots.map((root) => root.id)];
  const pending = roots.map((id, index) => ({
    id,
    tone: palette[index % palette.length],
    canSplit: true,
  }));
  while (pending.length) {
    const { id, tone, canSplit } = pending.pop()!;
    const node = document.nodes[id];
    if (!node || tones[id]) continue;
    tones[id] = tone;
    const children = node.children.map((childId) => document.nodes[childId]).filter(Boolean);
    // Skip single-child title wrappers, then assign colors at the first fork.
    // Once assigned, the entire topic subtree inherits its color, even when
    // deeper descendants form new groups or acquire children during editing.
    // Ignore collapse/selection/viewport so browsing never recolors the map.
    const split = canSplit && children.length > 1;
    for (const [index, child] of children.entries()) {
      const childTone = split ? palette[(palette.indexOf(tone) + index) % palette.length] : tone;
      pending.push({ id: child.id, tone: childTone, canSplit: canSplit && !split });
    }
  }
  return tones;
}
