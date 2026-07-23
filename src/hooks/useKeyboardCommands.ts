import { useEffect } from "react";
import {
  findCommandForEvent,
  isPrintableKey,
  type CommandId,
} from "../commands/registry";

interface KeyboardCommandOptions {
  enabled: boolean;
  onCommand: (id: CommandId) => void;
  onBeginTyping: (character: string) => void;
}

export function useKeyboardCommands({
  enabled,
  onCommand,
  onBeginTyping,
}: KeyboardCommandOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabled || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, [contenteditable='true']") ||
        target?.closest("[role='dialog']")
      ) {
        return;
      }

      const command = findCommandForEvent(event, "selection");
      if (command) {
        event.preventDefault();
        onCommand(command.id);
        return;
      }

      if (isPrintableKey(event) && event.key !== " ") {
        event.preventDefault();
        onBeginTyping(event.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onBeginTyping, onCommand]);
}
