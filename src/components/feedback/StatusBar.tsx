import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  savedLabel?: string;
  saveErrorActionLabel?: string;
}

function saveStateLabel(
  saveState: SaveState,
  savedLabel: string,
  saveErrorActionLabel: string,
): string {
  if (saveState === "loading") return "正在打开";
  if (saveState === "saving") return "正在保存";
  if (saveState === "error") {
    return `保存失败 · ${saveErrorActionLabel}`;
  }
  return savedLabel;
}

export function StatusBar({
  saveState,
  saveError,
  notice,
  onRetrySave,
  onNoticeActionComplete,
  onPauseNotice,
  onResumeNotice,
  savedLabel = "已保存",
  saveErrorActionLabel = "重试",
}: StatusBarProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(
    null,
  );
  const isError =
    saveState === "error" || notice?.tone === "error";
  const saveLabel = saveStateLabel(
    saveState,
    savedLabel,
    saveErrorActionLabel,
  );

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
    measureWidth,
    notice?.actionLabel,
    notice?.message,
    notice?.onAction,
    saveLabel,
  ]);

  useEffect(() => {
    window.addEventListener("resize", measureWidth);
    return () => window.removeEventListener("resize", measureWidth);
  }, [measureWidth]);

  const runNoticeAction = () => {
    notice?.onAction?.();
    onNoticeActionComplete();
  };

  const saveContent = (
    <>
      <span
        className={`status-bar__dot ${
          saveState === "saving" || saveState === "loading"
            ? "is-saving"
            : saveState === "error"
              ? "is-error"
              : ""
        }`}
      />
      <span>{saveLabel}</span>
    </>
  );

  return (
    <div
      aria-live={isError ? "assertive" : "polite"}
      className={`status-bar ${
        measuredWidth === null ? "" : "is-measured"
      } ${isError ? "status-bar--error" : ""}`}
      onBlurCapture={onResumeNotice}
      onFocusCapture={onPauseNotice}
      onPointerEnter={onPauseNotice}
      onPointerLeave={onResumeNotice}
      role={isError ? "alert" : "status"}
      style={
        measuredWidth === null
          ? undefined
          : { width: `${measuredWidth}px` }
      }
    >
      <div className="status-bar__content" ref={contentRef}>
        {saveState === "error" ? (
          <button
            aria-label={`保存失败，${saveErrorActionLabel}`}
            className="status-bar__save status-bar__save--error"
            onClick={onRetrySave}
            title={saveError ?? "保存失败"}
            type="button"
          >
            {saveContent}
          </button>
        ) : (
          <span className="status-bar__save">{saveContent}</span>
        )}

        {notice && (
          <>
            <span aria-hidden="true" className="status-bar__divider" />
            <span className="status-bar__message">
              {notice.message}
            </span>
            {notice.actionLabel && notice.onAction && (
              <button
                className="status-bar__action"
                onClick={runNoticeAction}
                type="button"
              >
                {notice.actionLabel}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
