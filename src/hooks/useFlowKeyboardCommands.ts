import { useEffect, useRef } from "react";
import {
  isDialogTarget,
  isNativeTextEditingTarget,
} from "./useKeyboardCommands";
import type { FlowNavigationDirection } from "../model/flowLayout";

interface FlowKeyboardCommandOptions {
  enabled: boolean;
  selectedId: string | null;
  onAddNext: (id: string) => void;
  onAddBranch: (id: string) => void;
  onBeginEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (direction: FlowNavigationDirection) => void;
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

function isFlowCommandTarget(target: EventTarget | null): boolean {
  const element = target as
    | { matches?: (selector: string) => boolean; closest?: (selector: string) => Element | null }
    | null;
  if (!element?.matches || !element.closest) return true;
  if (element.closest(".flow-canvas")) return true;
  return Boolean(element.matches("body, html"));
}

/**
 * Flow 键盘命令与思维导图一样挂在 window 捕获阶段，而不是画布容器的
 * DOM 焦点上：提交步骤文字后焦点会短暂落在 body，画布级监听会丢掉
 * 紧随其后的 Enter/Tab 连击。
 */
export function useFlowKeyboardCommands({
  enabled,
  selectedId,
  onAddNext,
  onAddBranch,
  onBeginEdit,
  onDelete,
  onNavigate,
  onBack,
  onUndo,
  onRedo,
}: FlowKeyboardCommandOptions) {
  const handlersRef = useRef({
    onAddNext,
    onAddBranch,
    onBeginEdit,
    onDelete,
    onNavigate,
    onBack,
    onUndo,
    onRedo,
    selectedId,
  });
  handlersRef.current = {
    onAddNext,
    onAddBranch,
    onBeginEdit,
    onDelete,
    onNavigate,
    onBack,
    onUndo,
    onRedo,
    selectedId,
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabled || event.defaultPrevented) return;
      if (isDialogTarget(event.target)) return;
      if (isNativeTextEditingTarget(event.target)) return;
      if (!isFlowCommandTarget(event.target)) return;
      const handlers = handlersRef.current;

      const isUndo =
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z";
      if (isUndo) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) handlers.onRedo();
        else handlers.onUndo();
        return;
      }

      const target = event.target as Element | null;
      // 菜单自己管理 Escape 与方向键；先让它关闭，再谈返回上层。
      if (target?.closest?.("[role='menu']")) return;
      // 直接连线由画布自己的取消路径收尾，不能把同一次 Escape
      // 同时解释成“取消连线”和“返回上层”。
      if (
        event.key === "Escape" &&
        document.querySelector(".flow-canvas[data-flow-connecting='true']")
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handlers.onBack();
        return;
      }
      // 适应内容按钮保留原生激活键（Enter/Space 触发点击）。
      if (target?.closest?.(".flow-fit-button")) return;

      const { selectedId: currentId } = handlers;
      if (!currentId) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        handlers.onAddNext(currentId);
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        handlers.onAddBranch(currentId);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        event.stopPropagation();
        handlers.onDelete(currentId);
      } else if (event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        handlers.onBeginEdit(currentId);
      } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key.slice(5).toLowerCase() as FlowNavigationDirection;
        handlers.onNavigate(direction);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [enabled]);
}
