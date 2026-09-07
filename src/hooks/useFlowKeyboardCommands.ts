import { useEffect, useRef } from "react";
import {
  isDialogTarget,
  isNativeTextEditingTarget,
} from "./useKeyboardCommands";
import { hasActiveCanvasDrag } from "./useDragInterruption";
import type { FlowNavigationDirection } from "../model/flowLayout";

interface FlowKeyboardCommandOptions {
  enabled: boolean;
  selectedId: string | null;
  selectedEdgeId?: string | null;
  onAddNext: (id: string) => void;
  onAddBranch: (id: string) => void;
  onBeginEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteEdge?: (id: string) => void;
  onClearEdgeSelection?: () => void;
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
  selectedEdgeId = null,
  onAddNext,
  onAddBranch,
  onBeginEdit,
  onDelete,
  onDeleteEdge = () => undefined,
  onClearEdgeSelection = () => undefined,
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
    onDeleteEdge,
    onClearEdgeSelection,
    onNavigate,
    onBack,
    onUndo,
    onRedo,
    selectedId,
    selectedEdgeId,
  });
  handlersRef.current = {
    onAddNext,
    onAddBranch,
    onBeginEdit,
    onDelete,
    onDeleteEdge,
    onClearEdgeSelection,
    onNavigate,
    onBack,
    onUndo,
    onRedo,
    selectedId,
    selectedEdgeId,
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // An active drag gesture owns Escape and cancels itself through its
      // own capture listener; registration order must not decide who wins.
      if (event.key === "Escape" && hasActiveCanvasDrag()) return;
      if (!enabled || event.defaultPrevented) return;
      if (isDialogTarget(event.target)) return;
      if (isNativeTextEditingTarget(event.target)) return;
      const handlers = handlersRef.current;

      const isUndo =
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z";
      if (isUndo && isFlowCommandTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) handlers.onRedo();
        else handlers.onUndo();
        return;
      }

      const target = event.target as Element | null;
      // 菜单自己管理 Escape 与方向键；先让它关闭，再谈返回上层。
      if (target?.closest?.("[role='menu'], [aria-haspopup='menu'][aria-expanded='true']")) return;
      if (target?.closest?.("[data-flow-edge-toolbar]")) return;
      // 返回上层是全局导航：焦点停留在画布外的应用控件（顶栏按钮等）时，
      // Esc 也必须能离开当前 Space，不能让键盘用户被困在流程层。
      if (handlers.selectedEdgeId && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handlers.onClearEdgeSelection();
        return;
      }
      if (
        handlers.selectedEdgeId &&
        isFlowCommandTarget(event.target) &&
        (event.key === "Backspace" || event.key === "Delete")
      ) {
        event.preventDefault();
        event.stopPropagation();
        handlers.onDeleteEdge(handlers.selectedEdgeId);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handlers.onBack();
        return;
      }
      // 结构编辑命令仍以画布为目标：焦点在应用控件上时，Enter/Space 等保留
      // 该控件的原生激活行为，也不在画布外误触删除或创建。
      if (!isFlowCommandTarget(event.target)) return;
      // 适应内容按钮保留原生激活键（Enter/Space 触发点击）。
      if (target?.closest?.("button, input, textarea, select, .flow-fit-button")) return;

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
