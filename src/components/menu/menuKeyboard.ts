import { useEffect, useRef, type RefObject } from "react";

const MENU_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/** Menus move focus to their first entry on open so arrow keys start the
 * roving cycle from the top. */
export function useMenuFocusOnOpen(
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLButtonElement>("[role='menuitem']")
      ?.focus({ preventScroll: true });
    // Focus-on-open is a one-shot side effect of the menu mounting.
  }, [containerRef]);
}

const DEFAULT_MENU_ITEM_SELECTOR =
  "[role='menuitem']:not(:disabled), [role='menuitemradio']:not(:disabled)";

/**
 * Visible, enabled menu entries in DOM order. `checkVisibility` (when the
 * engine provides it) also excludes entries inside hidden or collapsed
 * ancestors; otherwise the computed-display check covers the common case.
 */
export function focusableMenuItems(
  container: HTMLElement,
  selector: string = DEFAULT_MENU_ITEM_SELECTOR,
): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(selector),
  ).filter((item) =>
    typeof item.checkVisibility === "function"
      ? item.checkVisibility()
      : getComputedStyle(item).display !== "none",
  );
}

/**
 * One roving-focus algorithm for every menu surface (context menus, popovers,
 * the document switcher): Arrow keys cycle, Home/End jump. Returns true when
 * the key was consumed so callers can decide about preventDefault. A narrower
 * `selector` restricts the cycle (the document switcher keeps arrow flow to
 * its list entries, excluding hover-managed submenus).
 */
export function moveMenuFocus(
  container: HTMLElement,
  key: string,
  selector?: string,
): boolean {
  if (!MENU_NAVIGATION_KEYS.has(key)) return false;
  const items = focusableMenuItems(container, selector);
  if (items.length === 0) return false;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex =
    key === "Home"
      ? 0
      : key === "End"
        ? items.length - 1
        : key === "ArrowDown"
          ? (Math.max(index, -1) + 1) % items.length
          : (index <= 0 ? items.length : index) - 1;
  items[nextIndex]?.focus();
  return true;
}

interface MenuDismissalOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  onEscape: () => void;
  onOutsidePointer?: () => void;
  onOutsideFocus?: () => void;
}

/**
 * Shared context-menu dismissal: an outside pointer press, focus landing
 * outside the menu, and a capture-phase Escape (matching the arbitration
 * order the direct-manipulation interruption layer expects). Callbacks may
 * change every render; the window listeners stay stable.
 */
export function useMenuDismissal({
  containerRef,
  enabled = true,
  onEscape,
  onOutsidePointer,
  onOutsideFocus,
}: MenuDismissalOptions): void {
  const callbacks = useRef({
    onEscape,
    onOutsidePointer,
    onOutsideFocus,
  });
  callbacks.current = { onEscape, onOutsidePointer, onOutsideFocus };

  useEffect(() => {
    if (!enabled) return;
    const menu = containerRef.current;
    if (!menu) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && menu.contains(target);
    const closeForOutsidePointer = (event: PointerEvent) => {
      if (!inside(event.target)) callbacks.current.onOutsidePointer?.();
    };
    const closeForOutsideFocus = (event: FocusEvent) => {
      if (!inside(event.target)) callbacks.current.onOutsideFocus?.();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      callbacks.current.onEscape();
    };
    window.addEventListener("pointerdown", closeForOutsidePointer);
    window.addEventListener("focusin", closeForOutsideFocus);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeForOutsidePointer);
      window.removeEventListener("focusin", closeForOutsideFocus);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
    // The listeners close over the menu element captured at open time, so the
    // effect intentionally does not re-run when callers re-render.
  }, [containerRef, enabled]);
}
