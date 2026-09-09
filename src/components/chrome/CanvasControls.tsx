import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { canvasZoomFeedbackLabel } from "../../model/zoom";
import { Icon } from "../icons/Icon";

interface CanvasControlsProps {
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onReset: () => void;
}

export interface CanvasControlsHandle {
  showZoom: (zoom: number) => void;
}

const zoomFeedbackDuration = 1600;
const zoomFeedbackExitDuration = 220;

export const CanvasControls = forwardRef<
  CanvasControlsHandle,
  CanvasControlsProps
>(function CanvasControls(
  { onZoomOut, onZoomIn, onFit, onReset },
  ref,
) {
  useLocale();
  const [displayedZoom, setDisplayedZoom] = useState<number | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const displayedZoomRef = useRef<number | null>(null);
  const feedbackVisibleRef = useRef(false);
  const dismissTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    showZoom(nextZoom) {
      const nextLabel = canvasZoomFeedbackLabel(nextZoom);
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      if (displayedZoomRef.current === null ||
          canvasZoomFeedbackLabel(displayedZoomRef.current) !== nextLabel) {
        displayedZoomRef.current = nextZoom;
        setDisplayedZoom(nextZoom);
      }
      if (!feedbackVisibleRef.current) {
        feedbackVisibleRef.current = true;
        setFeedbackVisible(true);
      }
      dismissTimerRef.current = window.setTimeout(() => {
        feedbackVisibleRef.current = false;
        setFeedbackVisible(false);
        dismissTimerRef.current = null;
        clearTimerRef.current = window.setTimeout(() => {
          displayedZoomRef.current = null;
          setDisplayedZoom(null);
          clearTimerRef.current = null;
        }, zoomFeedbackExitDuration);
      }, zoomFeedbackDuration);
    },
  }), []);

  useEffect(
    () => () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    },
    [],
  );

  return (
    <div
      className={`canvas-controls ${
        feedbackVisible ? "is-feedback-visible" : ""
      }`}
    >
      <div
        aria-label={t("画布缩放")}
        className="canvas-controls__touch-actions"
      >
        <button aria-label={t("缩小")} onClick={onZoomOut} type="button">
          <Icon name="minus" size={17} />
        </button>
        <button aria-label={t("恢复 100%")} onClick={onReset} type="button">
          <span aria-hidden="true">100</span>
        </button>
        <button aria-label={t("放大")} onClick={onZoomIn} type="button">
          <Icon name="plus" size={17} />
        </button>
        <button aria-label={t("适应全部内容")} onClick={onFit} type="button">
          <Icon name="fit" size={17} />
        </button>
      </div>
      {displayedZoom !== null && (
        <output
          aria-hidden={!feedbackVisible}
          aria-live={feedbackVisible ? "polite" : "off"}
          className="canvas-controls__feedback"
        >
          {canvasZoomFeedbackLabel(displayedZoom)}
        </output>
      )}
    </div>
  );
});
