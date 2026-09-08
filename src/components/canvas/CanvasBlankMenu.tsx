import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  moveMenuFocus,
  useMenuDismissal,
  useMenuFocusOnOpen,
} from "../menu/menuKeyboard";

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
  useLocale();
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

  useMenuFocusOnOpen(menuRef);
  useMenuDismissal({
    containerRef: menuRef,
    onEscape: () => onClose(true),
    onOutsidePointer: () => onClose(false),
    onOutsideFocus: () => onClose(false),
  });

  const run = (action: () => void) => () => {
    onClose(true);
    action();
  };

  return (
    <div
      aria-label={t("画布操作")}
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
      <button onClick={run(onCreateNode)} role="menuitem" type="button">
        {t("新建浮动节点")}</button>
      <button onClick={run(onPaste)} role="menuitem" type="button">
        {t("粘贴")}</button>
      <button onClick={run(onFit)} role="menuitem" type="button">
        {t("适应视图")}</button>
    </div>
  );
}
