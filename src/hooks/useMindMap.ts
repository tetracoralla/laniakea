import { useCallback, useEffect, useRef, useState } from "react";
import { createSeedDocument } from "../data/seed";
import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from "../model/history";
import type { DocumentMutation } from "../model/tree";
import type {
  EditorSnapshot,
  MindMapDocument,
  SaveState,
  Viewport,
} from "../types/mindmap";

const storageKey = "origin.mindmap.v1";
function isDocument(value: unknown): value is MindMapDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MindMapDocument>;
  return (
    candidate.formatVersion === 1 &&
    typeof candidate.title === "string" &&
    typeof candidate.rootId === "string" &&
    Boolean(candidate.nodes?.[candidate.rootId])
  );
}

function loadInitialSnapshot(): EditorSnapshot {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const document = JSON.parse(stored) as unknown;
      if (isDocument(document)) {
        return { document, selectedId: document.rootId };
      }
    }
  } catch {
    // Invalid local data falls back to a valid seed without blocking startup.
  }

  const document = createSeedDocument();
  return { document, selectedId: "experience-2" };
}

export function useMindMap() {
  const [history, setHistory] = useState(() =>
    createEditorHistory(loadInitialSnapshot()),
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const snapshot = history.present;
  const latestDocument = useRef(history.present.document);

  useEffect(() => {
    latestDocument.current = snapshot.document;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(snapshot.document));
      } catch {
        // Saving remains local and non-blocking even when storage is unavailable.
      }
      setSaveState("saved");
    }, 320);
    return () => window.clearTimeout(timer);
  }, [snapshot.document]);

  useEffect(() => {
    const flush = () => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify(latestDocument.current),
        );
      } catch {
        // Closing the window must not be blocked by storage failure.
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  const applyMutation = useCallback(
    (mutate: (current: EditorSnapshot) => DocumentMutation) => {
      setHistory((current) => {
        const next = mutate(current.present);
        if (
          next.document === current.present.document &&
          next.selectedId === current.present.selectedId
        ) {
          return current;
        }
        const present = {
          document: next.document,
          selectedId: next.selectedId,
        };
        if (next.document === current.present.document) {
          return { ...current, present };
        }
        return commitEditorHistory(current, present);
      });
    },
    [],
  );

  const replaceDocument = useCallback((document: MindMapDocument) => {
    setHistory((current) =>
      commitEditorHistory(current, {
        document,
        selectedId: document.rootId,
      }),
    );
  }, []);

  const selectNode = useCallback((selectedId: string) => {
    setHistory((current) =>
      current.present.document.nodes[selectedId]
        ? {
            ...current,
            present: { ...current.present, selectedId },
          }
        : current,
    );
  }, []);

  const setViewport = useCallback((viewport: Viewport) => {
    setHistory((current) => ({
      ...current,
      present: {
        ...current.present,
        document: { ...current.present.document, viewport },
      },
    }));
  }, []);

  const undo = useCallback(() => {
    setHistory(undoEditorHistory);
  }, []);

  const redo = useCallback(() => {
    setHistory(redoEditorHistory);
  }, []);

  return {
    snapshot,
    saveState,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    applyMutation,
    replaceDocument,
    selectNode,
    setViewport,
    undo,
    redo,
  };
}
