import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotice } from "../types/feedback";

export function useAppNotice() {
  const [announcement, setAnnouncement] = useState<AppNotice | null>(null);
  const announcementRef = useRef<AppNotice | null>(null);
  const announcementTimer = useRef<number | null>(null);
  const announcementExpiresAt = useRef(0);
  const remainingDuration = useRef(0);
  const paused = useRef(false);

  const noticeDuration = (next: AppNotice) => next.onAction
    ? 10_000
    : next.tone === "error"
      ? 6200
      : 3600;

  const scheduleDismiss = useCallback((
    next: AppNotice,
    duration = noticeDuration(next),
  ) => {
    if (announcementTimer.current) {
      window.clearTimeout(announcementTimer.current);
    }
    remainingDuration.current = duration;
    announcementExpiresAt.current = Date.now() + duration;
    announcementTimer.current = window.setTimeout(() => {
      if (announcementRef.current === next) {
        announcementRef.current = null;
        setAnnouncement(null);
      }
      announcementTimer.current = null;
      remainingDuration.current = 0;
      announcementExpiresAt.current = 0;
    }, duration);
  }, []);

  const notify = useCallback(
    (next: AppNotice) => {
      announcementRef.current = next;
      setAnnouncement(next);
      const duration = noticeDuration(next);
      if (paused.current) {
        remainingDuration.current = duration;
        announcementExpiresAt.current = 0;
      } else {
        scheduleDismiss(next, duration);
      }
    },
    [scheduleDismiss],
  );

  const dismiss = useCallback(() => {
    if (announcementTimer.current) {
      window.clearTimeout(announcementTimer.current);
      announcementTimer.current = null;
    }
    announcementRef.current = null;
    remainingDuration.current = 0;
    announcementExpiresAt.current = 0;
    setAnnouncement(null);
  }, []);

  const pause = useCallback(() => {
    paused.current = true;
    if (announcementTimer.current) {
      remainingDuration.current = Math.max(
        0,
        announcementExpiresAt.current - Date.now(),
      );
      window.clearTimeout(announcementTimer.current);
      announcementTimer.current = null;
      announcementExpiresAt.current = 0;
    }
  }, []);

  const resume = useCallback(() => {
    paused.current = false;
    if (announcementRef.current) {
      scheduleDismiss(
        announcementRef.current,
        remainingDuration.current || noticeDuration(announcementRef.current),
      );
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
