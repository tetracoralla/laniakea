import { useEffect, useRef } from "react";
import {
  findCommandForEvent,
  isPrintableKey,
  type CommandId,
} from "../commands/registry";

interface KeyboardCommandOptions {
  enabled: boolean;
  selectionEnabled: boolean;
  onCommand: (id: CommandId) => void;
  onBeginTyping: (character: string) => void;
  onPasteText: (value: string) => void;
}

const nativeTextCommandIds = new Set<CommandId>([
  "history.undo",
  "history.redo",
]);

export function shouldRunGlobalCommand(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
  commandId: CommandId | undefined,
  textEditing: boolean,
): boolean {
  if (!commandId) return false;
  if (!textEditing) return true;
  if (nativeTextCommandIds.has(commandId)) return false;
  return event.metaKey || event.ctrlKey;
}

interface KeyboardTarget {
  matches?: (selector: string) => boolean;
  closest?: (selector: string) => Element | null;
}

function keyboardTarget(target: EventTarget | null): KeyboardTarget | null {
  return target as KeyboardTarget | null;
}

export function isDialogTarget(target: EventTarget | null): boolean {
  return Boolean(keyboardTarget(target)?.closest?.("[role='dialog']"));
}

export function isNativeTextEditingTarget(
  target: EventTarget | null,
): boolean {
  const element = keyboardTarget(target);
  if (!element?.matches || !element.closest) return false;
  return Boolean(
    element.matches("input, textarea, [contenteditable='true']"),
  );
}

export function isCanvasCommandTarget(target: EventTarget | null): boolean {
  const element = keyboardTarget(target);
  if (!element?.matches || !element.closest) return true;
  if (element.closest(".mindmap-canvas")) return true;
  return Boolean(element.matches("body, html"));
}

export function useKeyboardCommands({
  enabled,
  selectionEnabled,
  onCommand,
  onBeginTyping,
  onPasteText,
}: KeyboardCommandOptions) {
  const onCommandRef = useRef(onCommand);
  const onBeginTypingRef = useRef(onBeginTyping);
  const onPasteTextRef = useRef(onPasteText);
  onCommandRef.current = onCommand;
  onBeginTypingRef.current = onBeginTyping;
  onPasteTextRef.current = onPasteText;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabled || event.defaultPrevented) return;
      if (isDialogTarget(event.target)) return;

      const textEditing = isNativeTextEditingTarget(event.target);
      const globalCommand = findCommandForEvent(event, "global");
      if (
        globalCommand &&
        shouldRunGlobalCommand(event, globalCommand.id, textEditing)
      ) {
        event.preventDefault();
        if (textEditing) {
          (event.target as { blur?: () => void } | null)?.blur?.();
          window.queueMicrotask(() =>
            onCommandRef.current(globalCommand.id),
          );
        } else {
          window.getSelection()?.removeAllRanges();
          onCommandRef.current(globalCommand.id);
        }
        return;
      }

      if (
        !selectionEnabled ||
        textEditing ||
        !isCanvasCommandTarget(event.target)
      ) {
        return;
      }

      const command = findCommandForEvent(event, "selection");
      if (command) {
        if (command.id === "node.paste") {
          // Keep the platform paste gesture native. Its ClipboardEvent carries
          // the text synchronously and avoids a second clipboard-read prompt.
          return;
        }
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        onCommandRef.current(command.id);
        return;
      }

      if (isPrintableKey(event) && event.key !== " ") {
        event.preventDefault();
        onBeginTypingRef.current(event.key);
      }
    };

    const handlePaste = (event: ClipboardEvent) => {
      if (
        !enabled ||
        !selectionEnabled ||
        event.defaultPrevented ||
        isDialogTarget(event.target) ||
        isNativeTextEditingTarget(event.target) ||
        !isCanvasCommandTarget(event.target)
      ) {
        return;
      }
      const value = event.clipboardData?.getData("text/plain") ?? "";
      if (!value.trim()) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      onPasteTextRef.current(value);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("paste", handlePaste, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, {
        capture: true,
      });
      window.removeEventListener("paste", handlePaste, {
        capture: true,
      });
    };
  }, [enabled, selectionEnabled]);
}
