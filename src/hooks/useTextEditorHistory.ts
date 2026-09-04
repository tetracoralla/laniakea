import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

type TextEditorElement = HTMLInputElement | HTMLTextAreaElement;

interface TextEditorSnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface TextEditorHistory {
  past: TextEditorSnapshot[];
  present: TextEditorSnapshot;
  future: TextEditorSnapshot[];
}

interface TextEditorHistoryOptions<T extends TextEditorElement> {
  active: boolean;
  editorRef: RefObject<T | null>;
  onRestore: (value: string) => void;
  onRestored?: (editor: T) => void;
  sessionKey: string | null;
}

const historyLimit = 200;

function snapshot(editor: TextEditorElement): TextEditorSnapshot {
  const end = editor.value.length;
  return {
    value: editor.value,
    selectionStart: editor.selectionStart ?? end,
    selectionEnd: editor.selectionEnd ?? end,
  };
}

function historyCommand(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
): "undo" | "redo" | null {
  if (event.altKey || (!event.metaKey && !event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}

/**
 * Owns undo/redo for one mounted text-edit session. The history is reset when
 * the session changes and is deliberately never promoted into canvas history.
 */
export function useTextEditorHistory<T extends TextEditorElement>({
  active,
  editorRef,
  onRestore,
  onRestored,
  sessionKey,
}: TextEditorHistoryOptions<T>) {
  const historyRef = useRef<TextEditorHistory | null>(null);
  const onRestoreRef = useRef(onRestore);
  const onRestoredRef = useRef(onRestored);
  onRestoreRef.current = onRestore;
  onRestoredRef.current = onRestored;

  const reset = useCallback((editor: T) => {
    historyRef.current = {
      past: [],
      present: snapshot(editor),
      future: [],
    };
  }, []);

  useLayoutEffect(() => {
    if (!active || !sessionKey) {
      historyRef.current = null;
      return;
    }
    const editor = editorRef.current;
    if (editor) reset(editor);
  }, [active, editorRef, reset, sessionKey]);

  const record = useCallback((editor: T) => {
    const next = snapshot(editor);
    const current = historyRef.current;
    if (!current) {
      reset(editor);
      return;
    }
    if (next.value === current.present.value) {
      current.present = next;
      return;
    }
    historyRef.current = {
      past: [...current.past, current.present].slice(-historyLimit),
      present: next,
      future: [],
    };
  }, [reset]);

  const restore = useCallback((editor: T, next: TextEditorSnapshot) => {
    editor.value = next.value;
    const start = Math.min(next.selectionStart, next.value.length);
    const end = Math.min(next.selectionEnd, next.value.length);
    editor.setSelectionRange(start, end);
    onRestoreRef.current(next.value);
    onRestoredRef.current?.(editor);
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<T>) => {
    const command = historyCommand(event);
    if (!command) return false;
    event.preventDefault();
    event.stopPropagation();

    const current = historyRef.current;
    if (!current) return true;
    if (command === "undo") {
      const previous = current.past.at(-1);
      if (!previous) return true;
      historyRef.current = {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
      restore(event.currentTarget, previous);
      return true;
    }

    const next = current.future[0];
    if (!next) return true;
    historyRef.current = {
      past: [...current.past, current.present].slice(-historyLimit),
      present: next,
      future: current.future.slice(1),
    };
    restore(event.currentTarget, next);
    return true;
  }, [restore]);

  return { handleKeyDown, record, reset };
}
