import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

interface CanvasBlankMenuProps {
  onClose: (restoreFocus: boolean) => void;
  onCreateNode: () => void;
  onFit: () => void;
  onPaste: () => void;
  clientX: number;
  clientY: number;
}

/**
 * Context menu for empty canvas: create a free-floating node, paste a
 * clipboard subtree, or fit the view. Shares the node-space-menu styling.
 */
export function CanvasBlankMenu({
  onClose,
  onCreateNode,
  onFit,
  onPaste,
  clientX,
  clientY,
}: CanvasBlankMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuSize, setMenuSize] = useState({ width: 220, height: 116 });
  const location = useMemo(() => {
    const viewportInset = 12;
    const left = Math.max(
      viewportInset,
      Math.min(
        clientX,
        window.innerWidth - menuSize.width - viewportInset,
      ),
    );
    const top = Math.max(
      viewportInset,
      Math.min(
        clientY,
        window.innerHeight - menuSize.height - viewportInset,
      ),
    );
    return { left, top };
  }, [clientX, clientY, menuSize]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || menu.offsetWidth <= 0 || menu.offsetHeight <= 0) return;
    setMenuSize((current) =>
      current.width === menu.offsetWidth && current.height === menu.offsetHeight
        ? current
        : { width: menu.offsetWidth, height: menu.offsetHeight },
    );
  }, []);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role='menuitem']")
      ?.focus({ preventScroll: true });
    const closeForOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose(false);
    };
    const closeForOutsideFocus = (event: FocusEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    };
    window.addEventListener("pointerdown", closeForOutsidePointer);
    window.addEventListener("focusin", closeForOutsideFocus);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeForOutsidePointer);
      window.removeEventListener("focusin", closeForOutsideFocus);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose(true);
    action();
  };

  return (
    <div
      aria-label="画布操作"
      className="node-space-menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "[role='menuitem']:not(:disabled)",
        )];
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (currentIndex + direction + items.length) % items.length;
        items[nextIndex]?.focus();
      }}
      ref={menuRef}
      role="menu"
      style={location}
    >
      <button onClick={run(onCreateNode)} role="menuitem" type="button">
        新建浮动节点
      </button>
      <button onClick={run(onPaste)} role="menuitem" type="button">
        粘贴
      </button>
      <button onClick={run(onFit)} role="menuitem" type="button">
        适应视图
      </button>
    </div>
  );
}
