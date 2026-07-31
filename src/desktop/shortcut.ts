interface ShortcutKeyboardEvent {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

const modifierKeys = new Set([
  "Alt",
  "Control",
  "Meta",
  "Shift",
]);

function shortcutKey(event: ShortcutKeyboardEvent): string | null {
  if (modifierKeys.has(event.key)) return null;
  if (event.code.startsWith("Key")) return event.code.slice(3);
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  if (event.code === "Space") return "Space";
  return event.code || event.key;
}

export function shortcutFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
): string | null {
  const key = shortcutKey(event);
  const hasPrimaryModifier =
    event.metaKey || event.ctrlKey || event.altKey;
  if (!key || !hasPrimaryModifier) return null;

  const parts: string[] = [];
  if (event.metaKey) parts.push("CommandOrControl");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

const displayParts: Record<string, string> = {
  CommandOrControl: "⌘",
  Command: "⌘",
  Meta: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Space: "空格",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

export function displayGlobalShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => displayParts[part] ?? part)
    .join("");
}
