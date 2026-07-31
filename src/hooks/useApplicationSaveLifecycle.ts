import { useEffect, useRef } from "react";
import {
  listenForApplicationExit,
  resolveApplicationExit,
} from "../desktop/applicationLifecycle";
import { isDesktopRuntime } from "../persistence/localDocumentStore";

interface ApplicationSaveLifecycleOptions {
  prepareForSave?: () => void;
  saveBrowserNow: () => void;
  saveNow: () => Promise<boolean>;
  waitForStartupReady: () => Promise<void>;
}

export function useApplicationSaveLifecycle({
  prepareForSave,
  saveBrowserNow,
  saveNow,
  waitForStartupReady,
}: ApplicationSaveLifecycleOptions): void {
  const prepareForSaveRef = useRef(prepareForSave);
  prepareForSaveRef.current = prepareForSave;

  useEffect(() => {
    if (isDesktopRuntime()) {
      let unlistenClose: (() => void) | undefined;
      let unlistenExit: (() => void) | undefined;
      let active = true;
      let closeInProgress = false;
      let exitInProgress = false;
      let lifecycleSave: Promise<boolean> | null = null;
      const saveLatestForLifecycle = () => {
        if (!lifecycleSave) {
          lifecycleSave = waitForStartupReady()
            .then(() => {
              try {
                prepareForSaveRef.current?.();
              } catch {
                return false;
              }
              return saveNow();
            })
            .finally(() => {
              lifecycleSave = null;
            });
        }
        return lifecycleSave;
      };
      void (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (!active) return;
        const appWindow = getCurrentWindow();
        unlistenClose = await appWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          if (closeInProgress) return;
          closeInProgress = true;
          try {
            if (await saveLatestForLifecycle()) {
              await appWindow.hide();
            }
          } finally {
            closeInProgress = false;
          }
        });
        if (!active) {
          unlistenClose();
          return;
        }
        unlistenExit = await listenForApplicationExit(async () => {
          if (exitInProgress) return;
          exitInProgress = true;
          let saved = false;
          try {
            saved = await saveLatestForLifecycle();
            await resolveApplicationExit(saved);
          } finally {
            if (!saved) exitInProgress = false;
          }
        });
        if (!active) unlistenExit();
      })().catch(() => {
        // The native app remains open because Rust still owns the exit veto.
      });
      return () => {
        active = false;
        unlistenClose?.();
        unlistenExit?.();
      };
    }

    const flush = () => {
      try {
        prepareForSaveRef.current?.();
        saveBrowserNow();
      } catch {
        // A normal autosave already exposes the failure in the top bar.
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [saveBrowserNow, saveNow, waitForStartupReady]);
}
