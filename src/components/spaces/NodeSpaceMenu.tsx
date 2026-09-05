import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LaniakeaSpace } from "../../types/mindmap";
import {
  moveMenuFocus,
  useMenuDismissal,
  useMenuFocusOnOpen,
} from "../menu/menuKeyboard";

interface NodeSpaceMenuProps {
  nodeLabel: string;
  onClose: (restoreFocus: boolean) => void;
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
  const [menuSize, setMenuSize] = useState({
    width: 220,
    height: space ? 93 : 48,
  });
  const location = useMemo(() => {
    const viewportInset = 12;
    const targetGap = 10;
    const preferredLeft = targetRect.right + targetGap;
    const fallbackLeft = targetRect.left - targetGap - menuSize.width;
    const left = preferredLeft + menuSize.width <= window.innerWidth - viewportInset
      ? preferredLeft
      : fallbackLeft >= viewportInset
        ? fallbackLeft
        : Math.max(viewportInset, window.innerWidth - menuSize.width - viewportInset);
    return {
      left,
      top: Math.max(
        viewportInset,
        Math.min(
          targetRect.top,
          window.innerHeight - menuSize.height - viewportInset,
        ),
      ),
    };
  }, [menuSize, targetRect]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || menu.offsetWidth <= 0 || menu.offsetHeight <= 0) return;
    setMenuSize((current) =>
      current.width === menu.offsetWidth && current.height === menu.offsetHeight
        ? current
        : { width: menu.offsetWidth, height: menu.offsetHeight },
    );
  }, [space]);

  useMenuFocusOnOpen(menuRef);
  useMenuDismissal({
    containerRef: menuRef,
    onEscape: () => onClose(true),
    onOutsidePointer: () => onClose(false),
    onOutsideFocus: () => onClose(false),
  });

  const run = (action: () => void) => () => {
    onClose(false);
    action();
  };

  return (
    <div
      aria-label={`${nodeLabel || "未命名节点"}的节点操作`}
      className="node-space-menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (moveMenuFocus(event.currentTarget, event.key)) {
          event.preventDefault();
        }
      }}
      ref={menuRef}
      role="menu"
      style={location}
    >
      {space ? (
        <>
          <button onClick={run(onEnter)} role="menuitem" type="button">
            进入{space.type === "map" ? "思维图" : "流程"}
          </button>
          <div className="node-space-menu__separator" role="separator" />
          <button
            className="node-space-menu__danger"
            onClick={run(onDelete)}
            role="menuitem"
            type="button"
          >
            删除下层图
          </button>
        </>
      ) : (
        <button onClick={run(onDrillDown)} role="menuitem" type="button">
          下钻为…
        </button>
      )}
    </div>
  );
}
