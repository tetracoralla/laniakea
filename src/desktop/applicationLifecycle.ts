import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";

export const applicationExitRequestedEvent =
  "origin://application-exit-requested";

export async function listenForApplicationExit(
  handler: () => void | Promise<void>,
): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen(applicationExitRequestedEvent, handler);
  try {
    await invoke("register_application_exit_listener");
    return unlisten;
  } catch (error) {
    unlisten();
    throw error;
  }
}

export async function listenForWindowFocusChange(
  handler: (focused: boolean) => void,
): Promise<UnlistenFn> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onFocusChanged(({ payload }) => {
    handler(payload);
  });
}

export async function resolveApplicationExit(
  saved: boolean,
): Promise<void> {
  await invoke("resolve_application_exit", { saved });
}
