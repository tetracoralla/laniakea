import { useEffect, useRef } from "react";

interface DragInterruptionOptions {
  hasActiveDrag: () => boolean;
  onCancel: () => void;
}

/**
 * Owns host-level interruption for every direct-manipulation gesture. Target
 * geometry, preview, and durable commit remain in the calling drag policy.
 */
export function useDragInterruption({
  hasActiveDrag,
  onCancel,
}: DragInterruptionOptions) {
  const hasActiveDragRef = useRef(hasActiveDrag);
  const onCancelRef = useRef(onCancel);
  hasActiveDragRef.current = hasActiveDrag;
  onCancelRef.current = onCancel;

  useEffect(() => {
    const cancel = () => {
      if (hasActiveDragRef.current()) onCancelRef.current();
    };
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !hasActiveDragRef.current()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    const cancelWhenHidden = () => {
      if (globalThis.document.visibilityState === "hidden") cancel();
    };

    globalThis.window.addEventListener("blur", cancel);
    globalThis.window.addEventListener("keydown", cancelOnEscape, true);
    globalThis.document.addEventListener(
      "visibilitychange",
      cancelWhenHidden,
    );
    return () => {
      globalThis.window.removeEventListener("blur", cancel);
      globalThis.window.removeEventListener("keydown", cancelOnEscape, true);
      globalThis.document.removeEventListener(
        "visibilitychange",
        cancelWhenHidden,
      );
      cancel();
    };
  }, []);
}

export function releaseOwnedPointerCapture(
  element: HTMLElement,
  pointerId: number,
) {
  if (element.hasPointerCapture?.(pointerId)) {
    element.releasePointerCapture?.(pointerId);
  }
}
