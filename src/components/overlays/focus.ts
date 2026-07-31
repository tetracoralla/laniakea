import type {
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";

const focusableSelector = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function trapDialogTab(
  event: ReactKeyboardEvent,
  containerRef: RefObject<HTMLElement | null>,
): void {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    containerRef.current?.querySelectorAll<HTMLElement>(
      focusableSelector,
    ) ?? [],
  ).filter((control) => !control.hasAttribute("hidden"));
  if (controls.length === 0) return;
  const currentIndex = controls.indexOf(
    document.activeElement as HTMLElement,
  );
  const nextIndex = event.shiftKey
    ? currentIndex <= 0
      ? controls.length - 1
      : currentIndex - 1
    : currentIndex < 0 || currentIndex === controls.length - 1
      ? 0
      : currentIndex + 1;
  event.preventDefault();
  controls[nextIndex]?.focus();
}

export function restoreFocus(
  target: HTMLElement | null,
  fallback: () => void,
): void {
  window.requestAnimationFrame(() => {
    if (target?.isConnected) {
      target.focus({ preventScroll: true });
    } else {
      fallback();
    }
  });
}
