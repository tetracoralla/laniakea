import { useEffect, useRef } from "react";
import type { AppNotice } from "../types/feedback";
import type { SaveState } from "../types/mindmap";

interface BrowserStorageNoticeOptions {
  announcement: AppNotice | null;
  desktopRuntime: boolean;
  notify: (notice: AppNotice) => void;
  saveState: SaveState;
}

const storageNoticeKey = "laniakea:browser-storage-notice-seen";
const noticeHandoffDelay = 260;

export function useBrowserStorageNotice({
  announcement,
  desktopRuntime,
  notify,
  saveState,
}: BrowserStorageNoticeOptions) {
  const noticeShownRef = useRef(false);
  const noticePendingRef = useRef(false);
  const delayedHandoffRef = useRef(false);
  const handoffTimerRef = useRef<number | null>(null);
  const activeStorageNoticeRef = useRef<AppNotice | null>(null);
  const activeStorageNoticeVisibleRef = useRef(false);
  const previousSaveStateRef = useRef(saveState);

  useEffect(
    () => () => {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const previousSaveState = previousSaveStateRef.current;
    previousSaveStateRef.current = saveState;

    if (desktopRuntime || noticeShownRef.current) {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
      }
      noticePendingRef.current = false;
      return;
    }

    if (announcement !== null && handoffTimerRef.current !== null) {
      window.clearTimeout(handoffTimerRef.current);
      handoffTimerRef.current = null;
      noticePendingRef.current = true;
      delayedHandoffRef.current = true;
    }

    const activeStorageNotice = activeStorageNoticeRef.current;
    if (activeStorageNotice) {
      if (announcement === activeStorageNotice) {
        activeStorageNoticeVisibleRef.current = true;
        return;
      }

      activeStorageNoticeRef.current = null;
      if (activeStorageNoticeVisibleRef.current && announcement === null) {
        activeStorageNoticeVisibleRef.current = false;
        try {
          window.localStorage.setItem(storageNoticeKey, "true");
        } catch {
          // The notice was still delivered for this browser session.
        }
        noticeShownRef.current = true;
        return;
      }

      activeStorageNoticeVisibleRef.current = false;
      noticePendingRef.current = true;
      delayedHandoffRef.current = true;
    }

    if (previousSaveState === "saving" && saveState === "saved") {
      noticePendingRef.current = true;
      delayedHandoffRef.current = announcement !== null;
    }

    if (handoffTimerRef.current !== null) return;
    if (!noticePendingRef.current || announcement !== null) return;

    try {
      if (window.localStorage.getItem(storageNoticeKey) === "true") {
        noticeShownRef.current = true;
        noticePendingRef.current = false;
        return;
      }
    } catch {
      // The current browser session still gets the notice when storage for
      // remembering the acknowledgement is unavailable.
    }

    noticePendingRef.current = false;
    const showStorageNotice = () => {
      handoffTimerRef.current = null;
      const storageNotice = {
        message: "已保存在此浏览器，可在“更多”中导出完整备份",
      };
      activeStorageNoticeRef.current = storageNotice;
      notify(storageNotice);
    };

    if (delayedHandoffRef.current) {
      delayedHandoffRef.current = false;
      handoffTimerRef.current = window.setTimeout(
        showStorageNotice,
        noticeHandoffDelay,
      );
      return;
    }

    showStorageNotice();
  }, [announcement, desktopRuntime, notify, saveState]);
}
