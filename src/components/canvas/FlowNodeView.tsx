import {
  memo,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FlowLayoutNode } from "../../model/flowLayout";
import type {
  FlowNode,
  FlowPlacementDirection,
} from "../../types/mindmap";
import {
  isInputMethodKey,
  markInputMethodComposition,
} from "../../model/inputMethod";
import { useTextEditorHistory } from "../../hooks/useTextEditorHistory";

interface FlowNodeViewProps {
  draft: string;
  editing: boolean;
  node: FlowNode;
  connectableTarget: boolean;
  connectionTarget: boolean;
  connectionTargetPort: FlowPlacementDirection | null;
  connectingSource: boolean;
  onBeginEdit: (id: string) => void;
  onCancelEdit: () => void;
  onCommitEdit: (id: string, value: string) => void;
  onDraftChange: (value: string) => void;
  onOpenMenu: (
    nodeId: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
  ) => void;
  onConnectPointerDown: (
    id: string,
    port: FlowPlacementDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onNodePointerDown: (
    id: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onPortClick: (id: string, port: FlowPlacementDirection) => void;
  onPortIntentChange: (
    intent: { id: string; port: FlowPlacementDirection } | null,
  ) => void;
  onSelect: (id: string) => void;
  position: FlowLayoutNode;
  selected: boolean;
}

export const FlowNodeView = memo(function FlowNodeView({
  draft,
  editing,
  node,
  connectableTarget,
  connectionTarget,
  connectionTargetPort,
  connectingSource,
  onBeginEdit,
  onCancelEdit,
  onCommitEdit,
  onDraftChange,
  onOpenMenu,
  onConnectPointerDown,
  onNodePointerDown,
  onPortClick,
  onPortIntentChange,
  onSelect,
  position,
  selected,
}: FlowNodeViewProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const commitAfterCompositionRef = useRef(false);
  const editFinishedByKeyRef = useRef(false);
  const editorHistory = useTextEditorHistory({
    active: editing,
    editorRef,
    onRestore: onDraftChange,
    sessionKey: editing ? node.id : null,
  });

  useEffect(() => {
    if (!editing) return;
    editFinishedByKeyRef.current = false;
    editorRef.current?.focus({ preventScroll: true });
    editorRef.current?.select();
    if (editorRef.current) editorHistory.reset(editorRef.current);
  }, [editing, editorHistory.reset]);

  return (
    <div
      className={`flow-node flow-node--${node.kind}${selected ? " is-selected" : ""}${connectableTarget ? " is-connectable-target" : ""}${connectionTarget ? " is-connection-target" : ""}${connectingSource ? " is-connecting-source" : ""}`}
      data-connection-target-port={connectionTargetPort ?? undefined}
      data-flow-node-id={node.id}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        onOpenMenu(
          node.id,
          {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          },
          event.currentTarget.querySelector<HTMLElement>(
            ".flow-node__content",
          ) ?? event.currentTarget,
        );
      }}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        height: position.height,
      }}
    >
      {node.kind === "decision" && (
        <svg
          aria-hidden="true"
          className="flow-node__decision-shape"
          viewBox={`0 0 ${position.width} ${position.height}`}
        >
          <polygon
            points={`${position.width / 2},1 ${position.width - 1},${position.height / 2} ${position.width / 2},${position.height - 1} 1,${position.height / 2}`}
          />
        </svg>
      )}
      {editing ? (
        <div className="flow-node__content flow-node__editing">
          <div className="flow-node__text-surface">
            <div aria-hidden="true" className="flow-node__text-mirror">{draft || "输入步骤"}{"\u200b"}</div>
        <textarea
          aria-label="编辑流程步骤"
          className="flow-node__editor"
          defaultValue={draft}
          ref={editorRef}
          rows={1}
          placeholder={node.kind === "start" || node.kind === "end" ? "输入文字" : "输入步骤"}
          onBlur={(event) => {
            if (composingRef.current) {
              commitAfterCompositionRef.current = true;
              return;
            }
            if (!editFinishedByKeyRef.current) {
              onCommitEdit(node.id, event.currentTarget.value);
            }
          }}
          onChange={(event) => {
            if (!composingRef.current) {
              editorHistory.record(event.currentTarget);
              onDraftChange(event.target.value);
            }
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            markInputMethodComposition(event.currentTarget, false);
            editorHistory.record(event.currentTarget);
            onDraftChange(event.currentTarget.value);
            if (commitAfterCompositionRef.current) {
              commitAfterCompositionRef.current = false;
              onCommitEdit(node.id, event.currentTarget.value);
            }
          }}
          onCompositionStart={(event) => {
            composingRef.current = true;
            commitAfterCompositionRef.current = false;
            markInputMethodComposition(event.currentTarget, true);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (isInputMethodKey(event.nativeEvent, composingRef.current)) return;
            if (editorHistory.handleKeyDown(event)) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              editFinishedByKeyRef.current = true;
              onCommitEdit(node.id, event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              editFinishedByKeyRef.current = true;
              onCancelEdit();
            }
          }}
        />
          </div>
        </div>
      ) : (
        <button
          aria-pressed={selected}
          className={`flow-node__content ${node.text ? "" : "is-placeholder"}`}
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => onBeginEdit(node.id)}
          onPointerDown={(event) => onNodePointerDown(node.id, event)}
          type="button"
        >
          {node.text || (node.kind === "start" || node.kind === "end" ? "输入文字" : "输入步骤")}
        </button>
      )}
      {!editing && (
        <div className="flow-node__ports">
          {(["up", "right", "down", "left"] as const).map((port) => (
            <button
              aria-label={`从${port === "up" ? "上方" : port === "right" ? "右侧" : port === "down" ? "下方" : "左侧"}创建或拖线`}
              className={`flow-node__port flow-node__port--${port}`}
              key={port}
              tabIndex={selected ? 0 : -1}
              onClick={(event) => {
                event.stopPropagation();
                onPortClick(node.id, port);
              }}
              onBlur={() => onPortIntentChange(null)}
              onFocus={() => onPortIntentChange({ id: node.id, port })}
              onPointerLeave={() => onPortIntentChange(null)}
              onPointerDown={(event) => {
                event.stopPropagation();
                onConnectPointerDown(node.id, port, event);
              }}
              type="button"
            >
              <span
                aria-hidden="true"
                onPointerEnter={() => onPortIntentChange({ id: node.id, port })}
                onPointerLeave={() => onPortIntentChange(null)}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
