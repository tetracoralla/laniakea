import { useEffect, useRef } from "react";

interface DragInterruptionOptions {
  hasActiveDrag: () => boolean;
  onCancel: () => void;
}

interface DragInterruptionRegistration {
  cancel: () => void;
  isActive: () => boolean;
}

const dragRegistrations = new Set<DragInterruptionRegistration>();
let listeningForHostInterruption = false;

function activeDragRegistrations(): DragInterruptionRegistration[] {
  return [...dragRegistrations].filter(({ isActive }) => isActive());
}

function cancelActiveDrags() {
  activeDragRegistrations().forEach(({ cancel }) => cancel());
}

function cancelActiveDragsOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !hasActiveCanvasDrag()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancelActiveDrags();
}

function cancelActiveDragsWhenHidden() {
  if (globalThis.document.visibilityState === "hidden") cancelActiveDrags();
}

function startListeningForHostInterruption() {
  if (listeningForHostInterruption) return;
  listeningForHostInterruption = true;
  globalThis.window.addEventListener("blur", cancelActiveDrags);
  globalThis.window.addEventListener(
    "keydown",
    cancelActiveDragsOnEscape,
    true,
  );
  globalThis.document.addEventListener(
    "visibilitychange",
    cancelActiveDragsWhenHidden,
  );
}

function stopListeningForHostInterruption() {
  if (!listeningForHostInterruption || dragRegistrations.size > 0) return;
  listeningForHostInterruption = false;
  globalThis.window.removeEventListener("blur", cancelActiveDrags);
  globalThis.window.removeEventListener(
    "keydown",
    cancelActiveDragsOnEscape,
    true,
  );
  globalThis.document.removeEventListener(
    "visibilitychange",
    cancelActiveDragsWhenHidden,
  );
}

/**
 * True while any direct-manipulation gesture is in progress. Keyboard
 * command routing consults this so Escape arbitration between the two
 * window-capture listeners never depends on their registration order.
 */
export function hasActiveCanvasDrag(): boolean {
  for (const { isActive } of dragRegistrations) {
    if (isActive()) return true;
  }
  return false;
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
    const registration: DragInterruptionRegistration = {
      cancel: () => {
        if (hasActiveDragRef.current()) onCancelRef.current();
      },
      isActive: () => hasActiveDragRef.current(),
    };
    dragRegistrations.add(registration);
    startListeningForHostInterruption();
    return () => {
      const active = registration.isActive();
      dragRegistrations.delete(registration);
      stopListeningForHostInterruption();
      if (active) registration.cancel();
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
