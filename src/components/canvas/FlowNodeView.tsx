import {
  memo,
  useEffect,
  useRef,
} from "react";
import type { FlowLayoutNode } from "../../model/flowLayout";
import type { FlowNode } from "../../types/mindmap";

interface FlowNodeViewProps {
  draft: string;
  editing: boolean;
  node: FlowNode;
  onBeginEdit: (id: string) => void;
  onCancelEdit: () => void;
  onCommitEdit: (id: string, value: string) => void;
  onDraftChange: (value: string) => void;
  onOpenMenu: (
    nodeId: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
  ) => void;
  onSelect: (id: string) => void;
  position: FlowLayoutNode;
  selected: boolean;
}

export const FlowNodeView = memo(function FlowNodeView({
  draft,
  editing,
  node,
  onBeginEdit,
  onCancelEdit,
  onCommitEdit,
  onDraftChange,
  onOpenMenu,
  onSelect,
  position,
  selected,
}: FlowNodeViewProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const editFinishedByKeyRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    editFinishedByKeyRef.current = false;
    editorRef.current?.focus({ preventScroll: true });
    editorRef.current?.select();
  }, [editing]);

  return (
    <div
      className={`flow-node flow-node--${node.kind}${selected ? " is-selected" : ""}`}
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
        <textarea
          aria-label="编辑流程步骤"
          className="flow-node__editor"
          defaultValue={draft}
          ref={editorRef}
          rows={1}
          onBlur={(event) => {
            if (!composingRef.current && !editFinishedByKeyRef.current) {
              onCommitEdit(node.id, event.currentTarget.value);
            }
          }}
          onChange={(event) => {
            if (!composingRef.current) onDraftChange(event.target.value);
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            onDraftChange(event.currentTarget.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (composingRef.current || event.nativeEvent.isComposing) return;
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
      ) : (
        <button
          aria-pressed={selected}
          className="flow-node__content"
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => onBeginEdit(node.id)}
          type="button"
        >
          {node.text || "输入步骤"}
        </button>
      )}
    </div>
  );
});
