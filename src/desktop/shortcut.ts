import {
  displayShortcutCombination,
  isMacLikePlatform,
} from "../model/shortcutDisplay";

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
  macLike = isMacLikePlatform(),
): string | null {
  const key = shortcutKey(event);
  // Tauri's CommandOrControl means Ctrl away from macOS. Silently accepting
  // Super/Windows here would therefore register a different shortcut from
  // the one the user actually pressed.
  if (event.metaKey && !macLike) return null;
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

export function displayGlobalShortcut(shortcut: string): string {
  return displayShortcutCombination(shortcut);
}
