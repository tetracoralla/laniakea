import type { EditorSnapshot } from "../types/mindmap";

export interface EditorHistory {
  present: EditorSnapshot;
  past: EditorSnapshot[];
  future: EditorSnapshot[];
}

export const editorHistoryLimit = 100;

export function createEditorHistory(present: EditorSnapshot): EditorHistory {
  return { present, past: [], future: [] };
}

export function commitEditorHistory(
  current: EditorHistory,
  present: EditorSnapshot,
): EditorHistory {
  return {
    present,
    past: [...current.past, current.present].slice(-editorHistoryLimit),
    future: [],
  };
}

export function undoEditorHistory(current: EditorHistory): EditorHistory {
  const previous = current.past.at(-1);
  if (!previous) return current;
  return {
    present: previous,
    past: current.past.slice(0, -1),
    future: [current.present, ...current.future].slice(0, editorHistoryLimit),
  };
}

export function redoEditorHistory(current: EditorHistory): EditorHistory {
  const next = current.future[0];
  if (!next) return current;
  return {
    present: next,
    past: [...current.past, current.present].slice(-editorHistoryLimit),
    future: current.future.slice(1),
  };
}
