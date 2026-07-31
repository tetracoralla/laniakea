import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "../persistence/localDocumentStore";

export interface DesktopRuntimeStatus {
  globalShortcutRegistered: boolean;
  globalShortcut: string;
}

export async function readDesktopRuntimeStatus(): Promise<DesktopRuntimeStatus | null> {
  if (!isDesktopRuntime()) return null;
  return invoke<DesktopRuntimeStatus>("desktop_runtime_status");
}

export async function updateDesktopGlobalShortcut(
  globalShortcut: string,
): Promise<DesktopRuntimeStatus> {
  return invoke<DesktopRuntimeStatus>("set_global_shortcut", {
    globalShortcut,
  });
}
