import { invoke, isTauri } from "@tauri-apps/api/core";

interface DesktopRuntimeStatus {
  globalShortcutRegistered: boolean;
  globalShortcut: string;
}

export async function readDesktopRuntimeStatus(): Promise<DesktopRuntimeStatus | null> {
  if (!isTauri()) return null;
  return invoke<DesktopRuntimeStatus>("desktop_runtime_status");
}
