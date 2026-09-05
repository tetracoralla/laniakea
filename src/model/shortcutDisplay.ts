/**
 * Platform-aware shortcut display. macOS keeps the compact modifier glyphs
 * (⌘⌥⇧⌃) joined without separators; Windows/Linux spell modifiers out and
 * join with "+". Detection defaults to mac glyphs where there is no real
 * navigator (tests, SSR) so existing expectations stay stable.
 */
export function isMacLikePlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const macParts: Record<string, string> = {
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

// Tauri maps CommandOrControl to Ctrl on Windows and Linux.
const pcParts: Record<string, string> = {
  ...macParts,
  CommandOrControl: "Ctrl",
  Command: "Ctrl",
  // Command-registry `Meta` means the platform's primary command modifier;
  // its event matcher accepts Ctrl on Windows/Linux.
  Meta: "Ctrl",
  Control: "Ctrl",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
};

export function displayShortcutParts(parts: readonly string[]): string {
  const glyphs = isMacLikePlatform() ? macParts : pcParts;
  const joiner = isMacLikePlatform() ? "" : "+";
  return parts.map((part) => glyphs[part] ?? part).join(joiner);
}

export function displayShortcutCombination(shortcut: string): string {
  return displayShortcutParts(shortcut.split("+"));
}

/** Hint text for the recorder: which primary modifiers start a combination. */
export function primaryModifierHint(): string {
  return isMacLikePlatform()
    ? "请同时按住 ⌘、⌃ 或 ⌥"
    : "请同时按住 Ctrl 或 Alt";
}
