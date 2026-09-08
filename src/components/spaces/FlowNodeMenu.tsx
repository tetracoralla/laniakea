import { useLocale } from "../../i18n/useLocale";
import { t, localizeMessage } from "../../i18n/locale";
import { useMemo, useRef, useState } from "react";
import type { FlowNode, FlowNodeKind } from "../../types/mindmap";
import { Icon } from "../icons/Icon";
import {
  moveMenuFocus,
  useMenuDismissal,
  useMenuFocusOnOpen,
} from "../menu/menuKeyboard";

interface FlowNodeMenuProps {
  canConnect: boolean;
  node: FlowNode;
  onAddBranch: () => void;
  onAddNext: () => void;
  onBeginEdit: () => void;
  onChangeKind: (kind: FlowNodeKind) => void;
  onClose: (restoreFocus: boolean) => void;
  onConnect: () => void;
  onDelete: () => void;
  targetRect: { left: number; right: number; top: number; bottom: number };
}

const kindLabels: Record<FlowNodeKind, string> = {
  start: "开始",
  step: "步骤",
  decision: "判断",
  end: "结束",
};

export function FlowNodeMenu({
  canConnect,
  node,
  onAddBranch,
  onAddNext,
  onBeginEdit,
  onChangeKind,
  onClose,
  onConnect,
  onDelete,
  targetRect,
}: FlowNodeMenuProps) {
  useLocale();
  const menuRef = useRef<HTMLDivElement>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const location = useMemo(() => {
    const width = 220;
    const inset = 12;
    const gap = 10;
    const right = targetRect.right + gap;
    const left = targetRect.left - width - gap;
    return {
      left: right + width <= window.innerWidth - inset
        ? right
        : Math.max(inset, left),
      top: Math.max(inset, Math.min(targetRect.top, window.innerHeight - 320)),
    };
  }, [targetRect]);

  useMenuFocusOnOpen(menuRef);
  useMenuDismissal({
    containerRef: menuRef,
    onEscape: () => onClose(true),
    onOutsidePointer: () => onClose(false),
    onOutsideFocus: () => onClose(false),
  });

  return (
    <div
      aria-label={t("{0}的流程操作", node.text || t("未命名步骤"))}
      className="node-space-menu flow-node-menu"
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
      <button onClick={onBeginEdit} role="menuitem" type="button">
        {t("编辑文字")}</button>
      <button
        onClick={onAddNext}
        role="menuitem"
        type="button"
      >
        {t("添加下一步")}</button>
      <button
        onClick={onAddBranch}
        role="menuitem"
        type="button"
      >
        {t("添加分支")}</button>
      <button
        disabled={!canConnect}
        onClick={onConnect}
        role="menuitem"
        type="button"
      >
        {t("汇合到已有步骤…")}</button>
      <div className="node-space-menu__separator" role="separator" />
      <button
        aria-expanded={typeOpen}
        aria-haspopup="menu"
        className="flow-node-menu__type-trigger"
        onClick={() => setTypeOpen((current) => !current)}
        role="menuitem"
        type="button"
      >
        <span>{t("节点类型")}</span>
        <span className="flow-node-menu__value">
          {localizeMessage(kindLabels[node.kind])}
          <Icon name="chevronDown" size={12} />
        </span>
      </button>
      {typeOpen && (
        <div aria-label={t("节点类型")} className="flow-node-menu__types" role="group">
          {(Object.entries(kindLabels) as Array<[FlowNodeKind, string]>).map(
            ([kind, label]) => (
              <button
                aria-checked={node.kind === kind}
                key={kind}
                onClick={() => onChangeKind(kind)}
                role="menuitemradio"
                type="button"
              >
                {localizeMessage(label)}
                {node.kind === kind && <Icon name="check" size={12} />}
              </button>
            ),
          )}
        </div>
      )}
      <div className="node-space-menu__separator" role="separator" />
      <button
        className="node-space-menu__danger"
        onClick={onDelete}
        role="menuitem"
        type="button"
      >
        {t("删除步骤")}</button>
    </div>
  );
}
