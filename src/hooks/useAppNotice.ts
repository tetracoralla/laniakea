import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotice } from "../types/feedback";

export function useAppNotice() {
  const [announcement, setAnnouncement] = useState<AppNotice | null>(null);
  const announcementRef = useRef<AppNotice | null>(null);
  const announcementTimer = useRef<number | null>(null);

  const scheduleDismiss = useCallback((next: AppNotice) => {
    if (announcementTimer.current) {
      window.clearTimeout(announcementTimer.current);
    }
    const duration = next.onAction
      ? 10_000
      : next.tone === "error"
        ? 6200
        : 3600;
    announcementTimer.current = window.setTimeout(() => {
      if (announcementRef.current === next) {
        announcementRef.current = null;
        setAnnouncement(null);
      }
      announcementTimer.current = null;
    }, duration);
  }, []);

  const notify = useCallback(
    (next: AppNotice) => {
      announcementRef.current = next;
      setAnnouncement(next);
      scheduleDismiss(next);
    },
    [scheduleDismiss],
  );

  const dismiss = useCallback(() => {
    if (announcementTimer.current) {
      window.clearTimeout(announcementTimer.current);
      announcementTimer.current = null;
    }
    announcementRef.current = null;
    setAnnouncement(null);
  }, []);

  const pause = useCallback(() => {
    if (announcementTimer.current) {
      window.clearTimeout(announcementTimer.current);
      announcementTimer.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    if (announcementRef.current) {
      scheduleDismiss(announcementRef.current);
    }
  }, [scheduleDismiss]);

  useEffect(
    () => () => {
      if (announcementTimer.current) {
        window.clearTimeout(announcementTimer.current);
      }
    },
    [],
  );

  return {
    announcement,
    notify,
    dismiss,
    pause,
    resume,
  };
}
