import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppNotice } from "../../types/feedback";
import type { SaveState } from "../../types/mindmap";

interface StatusBarProps {
  saveState: SaveState;
  saveError: string | null;
  notice: AppNotice | null;
  onRetrySave: () => void;
  onNoticeActionComplete: () => void;
  onPauseNotice: () => void;
  onResumeNotice: () => void;
  saveErrorActionLabel?: string;
}

interface DisplayedSaveStatus {
  actionLabel: string;
  error: string | null;
  state: Exclude<SaveState, "saved">;
}

const contentExitDuration = 160;
const shellExitDuration = 240;
const collapsedShellWidth = 38;

function useAnimatedPresence<T>(value: T | null) {
  const [displayedValue, setDisplayedValue] = useState<T | null>(value);
  const [visible, setVisible] = useState(false);
  const displayedValueRef = useRef(displayedValue);

  displayedValueRef.current = displayedValue;

  useEffect(() => {
    let animationFrame: number | null = null;
    let exitTimer: number | null = null;

    if (value !== null) {
      setDisplayedValue(value);
      setVisible(false);
      animationFrame = window.requestAnimationFrame(() => {
        setVisible(true);
      });
    } else if (displayedValueRef.current !== null) {
      setVisible(false);
      exitTimer = window.setTimeout(() => {
        setDisplayedValue(null);
      }, contentExitDuration);
    }

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (exitTimer !== null) {
        window.clearTimeout(exitTimer);
      }
    };
  }, [value]);

  return { displayedValue, visible };
}

function saveStateLabel(
  saveState: SaveState,
  saveErrorActionLabel: string,
): string {
  if (saveState === "loading") return "正在打开";
  if (saveState === "saving") return "正在保存";
  if (saveState === "error") {
    return `保存失败 · ${saveErrorActionLabel}`;
  }
  return "";
}

export function StatusBar({
  saveState,
  saveError,
  notice,
  onRetrySave,
  onNoticeActionComplete,
  onPauseNotice,
  onResumeNotice,
  saveErrorActionLabel = "重试",
}: StatusBarProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(
    null,
  );
  const [progressVisible, setProgressVisible] = useState(false);
  const nextSaveStatus = useMemo<DisplayedSaveStatus | null>(
    () =>
      saveState === "error" ||
      (progressVisible &&
        (saveState === "saving" || saveState === "loading"))
        ? {
            actionLabel: saveErrorActionLabel,
            error: saveError,
            state: saveState,
          }
        : null,
    [progressVisible, saveError, saveErrorActionLabel, saveState],
  );
  const {
    displayedValue: displayedSaveStatus,
    visible: saveStatusVisible,
  } = useAnimatedPresence(nextSaveStatus);
  const {
    displayedValue: displayedNotice,
    visible: noticeVisible,
  } = useAnimatedPresence(notice);
  const contentPresent =
    displayedSaveStatus !== null || displayedNotice !== null;
  const [shellMounted, setShellMounted] = useState(contentPresent);
  const [shellExpanded, setShellExpanded] = useState(false);
  const isError =
    displayedSaveStatus?.state === "error" ||
    displayedNotice?.tone === "error";
  const saveLabel = displayedSaveStatus
    ? saveStateLabel(
        displayedSaveStatus.state,
        displayedSaveStatus.actionLabel,
      )
    : "";

  useEffect(() => {
    if (saveState !== "saving" && saveState !== "loading") {
      setProgressVisible(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setProgressVisible(true);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  useEffect(() => {
    let animationFrame: number | null = null;
    let exitTimer: number | null = null;

    if (contentPresent) {
      setShellMounted(true);
      animationFrame = window.requestAnimationFrame(() => {
        setShellExpanded(true);
      });
    } else {
      setShellExpanded(false);
      if (shellMounted) {
        exitTimer = window.setTimeout(() => {
          setShellMounted(false);
        }, shellExitDuration);
      }
    }

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (exitTimer !== null) {
        window.clearTimeout(exitTimer);
      }
    };
  }, [contentPresent, shellMounted]);

  const measureWidth = useCallback(() => {
    const contentWidth = contentRef.current?.scrollWidth ?? 0;
    if (contentWidth <= 0) return;
    const viewportLimit = Math.max(120, window.innerWidth - 220);
    setMeasuredWidth(
      Math.min(420, viewportLimit, Math.ceil(contentWidth) + 2),
    );
  }, []);

  useLayoutEffect(() => {
    measureWidth();
  }, [
    displayedNotice?.actionLabel,
    displayedNotice?.message,
    displayedNotice?.onAction,
    displayedSaveStatus,
    measureWidth,
    saveLabel,
    shellMounted,
  ]);

  useEffect(() => {
    window.addEventListener("resize", measureWidth);
    return () => window.removeEventListener("resize", measureWidth);
  }, [measureWidth]);

  const runNoticeAction = () => {
    displayedNotice?.onAction?.();
    onNoticeActionComplete();
  };

  const renderedSaveState = displayedSaveStatus?.state;
  const saveContent = displayedSaveStatus ? (
    <>
      {renderedSaveState === "error" ? (
        <span aria-hidden="true" className="status-bar__error-icon" />
      ) : (
        <span aria-hidden="true" className="status-bar__spinner" />
      )}
      <span>{saveLabel}</span>
    </>
  ) : null;

  if (!shellMounted) return null;

  return (
    <div
      aria-live={isError ? "assertive" : "polite"}
      className={`status-bar ${
        measuredWidth === null ? "" : "is-measured"
      } ${shellExpanded ? "is-expanded" : ""} ${
        isError ? "status-bar--error" : ""
      }`}
      onBlurCapture={onResumeNotice}
      onFocusCapture={onPauseNotice}
      onPointerEnter={onPauseNotice}
      onPointerLeave={onResumeNotice}
      role={isError ? "alert" : "status"}
      style={
        {
          width:
            shellExpanded && measuredWidth !== null
              ? `${measuredWidth}px`
              : `${collapsedShellWidth}px`,
        }
      }
    >
      <div className="status-bar__content" ref={contentRef}>
        {displayedSaveStatus && renderedSaveState === "error" ? (
          <button
            aria-label={`保存失败，${displayedSaveStatus.actionLabel}`}
            className={`status-bar__save status-bar__save--error ${
              saveStatusVisible ? "is-visible" : ""
            }`}
            onClick={onRetrySave}
            title={displayedSaveStatus.error ?? "保存失败"}
            type="button"
          >
            {saveContent}
          </button>
        ) : displayedSaveStatus ? (
          <span
            className={`status-bar__save ${
              saveStatusVisible ? "is-visible" : ""
            }`}
          >
            {saveContent}
          </span>
        ) : null}

        {displayedNotice && (
          <span
            className={`status-bar__notice ${
              noticeVisible ? "is-visible" : ""
            }`}
          >
            {displayedSaveStatus && (
              <span aria-hidden="true" className="status-bar__divider" />
            )}
            <span className="status-bar__message">
              {displayedNotice.message}
            </span>
            {displayedNotice.actionLabel && displayedNotice.onAction && (
              <button
                className="status-bar__action"
                onClick={runNoticeAction}
                type="button"
              >
                {displayedNotice.actionLabel}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
