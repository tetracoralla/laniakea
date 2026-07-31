import type {
  MindMapDocument,
  SelectionState,
} from "../types/mindmap";
import { topLevelRootIds } from "./document";

export function emptySelection(): SelectionState {
  return { primaryId: null, selectedIds: [] };
}

export function singleSelection(id: string): SelectionState {
  return { primaryId: id, selectedIds: [id] };
}

export function createSelection(
  ids: Iterable<string>,
  order: readonly string[],
  preferredPrimary?: string | null,
): SelectionState {
  const requested = new Set(ids);
  const selectedIds = order.filter((id) => requested.has(id));
  const selected = new Set(selectedIds);
  const primaryId =
    (preferredPrimary && selected.has(preferredPrimary)
      ? preferredPrimary
      : selectedIds[0]) ?? null;
  return { primaryId, selectedIds };
}

export function selectionEquals(
  left: SelectionState,
  right: SelectionState,
): boolean {
  return (
    left.primaryId === right.primaryId &&
    left.selectedIds.length === right.selectedIds.length &&
    left.selectedIds.every((id, index) => id === right.selectedIds[index])
  );
}

export function toggleSelectedNode(
  selection: SelectionState,
  id: string,
  order: readonly string[],
): SelectionState {
  const selected = new Set(selection.selectedIds);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);

  const preferredPrimary = selected.has(id)
    ? id
    : selection.primaryId === id
      ? null
      : selection.primaryId;
  return createSelection(selected, order, preferredPrimary);
}

export function addToSelection(
  selection: SelectionState,
  ids: Iterable<string>,
  order: readonly string[],
): SelectionState {
  const selected = new Set(selection.selectedIds);
  for (const id of ids) selected.add(id);
  return createSelection(selected, order, selection.primaryId);
}

export function visibleNodeIds(document: MindMapDocument): string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    const node = document.nodes[id];
    if (!node) return;
    result.push(id);
    if (!node.collapsed) node.children.forEach(visit);
  };
  topLevelRootIds(document).forEach(visit);
  return result;
}

export function normalizeSelectedRoots(
  document: MindMapDocument,
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(selectedIds);
  return selectedIds.filter((id) => {
    let parentId = document.nodes[id]?.parentId ?? null;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = document.nodes[parentId]?.parentId ?? null;
    }
    return Boolean(document.nodes[id]);
  });
}
