import { useEffect, useMemo, useRef } from "react";
import type { LaniakeaSpace } from "../../types/mindmap";

interface NodeSpaceMenuProps {
  nodeLabel: string;
  onClose: () => void;
  onDelete: () => void;
  onDrillDown: () => void;
  onEnter: () => void;
  targetRect: { left: number; right: number; top: number; bottom: number };
  space: LaniakeaSpace | null;
}

export function NodeSpaceMenu({
  nodeLabel,
  onClose,
  onDelete,
  onDrillDown,
  onEnter,
  targetRect,
  space,
}: NodeSpaceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useMemo(() => {
    const menuWidth = 220;
    const viewportInset = 12;
    const targetGap = 10;
    const preferredLeft = targetRect.right + targetGap;
    const fallbackLeft = targetRect.left - targetGap - menuWidth;
    const left = preferredLeft + menuWidth <= window.innerWidth - viewportInset
      ? preferredLeft
      : fallbackLeft >= viewportInset
        ? fallbackLeft
        : Math.max(viewportInset, window.innerWidth - menuWidth - viewportInset);
    return {
      left,
      top: Math.max(viewportInset, Math.min(targetRect.top, window.innerHeight - 148)),
    };
  }, [targetRect]);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role='menuitem']")
      ?.focus({ preventScroll: true });
    const closeForOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", closeForOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeForOutsidePointer);
  }, [onClose]);

  return (
    <div
      aria-label={`${nodeLabel || "未命名节点"}的下层图操作`}
      className="node-space-menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
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
      {space ? (
        <>
          <button onClick={onEnter} role="menuitem" type="button">
            进入{space.type === "map" ? "思维图" : "流程"}
          </button>
          <div className="node-space-menu__separator" role="separator" />
          <button
            className="node-space-menu__danger"
            onClick={onDelete}
            role="menuitem"
            type="button"
          >
            删除下层图
          </button>
        </>
      ) : (
        <button onClick={onDrillDown} role="menuitem" type="button">
          下钻为…
        </button>
      )}
    </div>
  );
}
