import {
  memo,
  useLayoutEffect,
  useRef,
  type PointerEventHandler,
} from "react";
import {
  emptyNodeLabel,
  nodePlaceholder,
} from "../../model/canvasRender";
import type { LayoutNode, MindNode } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface MindMapNodeProps {
  node: MindNode;
  layout: LayoutNode;
  selected: boolean;
  primary: boolean;
  editing: boolean;
  draft: string;
  dragging: boolean;
  dropTarget: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onBeginEdit: (id: string) => void;
  onDraftChange: (value: string) => void;
  onPasteStructured: (id: string, value: string) => boolean;
  onCommitEdit: (id: string, value: string) => void;
  onCancelEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onDragPointerDown: PointerEventHandler<HTMLDivElement>;
}

export const MindMapNode = memo(function MindMapNode({
  node,
  layout,
  selected,
  primary,
  editing,
  draft,
  dragging,
  dropTarget,
  onSelect,
  onBeginEdit,
  onDraftChange,
  onPasteStructured,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onDragPointerDown,
}: MindMapNodeProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const inputMethodComposingRef = useRef(false);
  const placeholder = nodePlaceholder(layout);
  const empty = node.text.length === 0;

  useLayoutEffect(() => {
    if (!editing) return;
    editorRef.current?.focus();
    editorRef.current?.setSelectionRange(draft.length, draft.length);
  }, [editing]);

  return (
    <div
      className={`mind-node mind-node--${layout.rootKind === "main" ? "root" : layout.rootKind === "floating" ? "floating" : layout.depth === 1 ? "branch" : "leaf"} mind-node--${layout.tone} ${selected ? "is-selected" : ""} ${primary ? "is-primary" : ""} ${dragging ? "is-dragging" : ""} ${dropTarget ? "is-drop-target" : ""}`}
      data-node-id={node.id}
      onPointerDown={onDragPointerDown}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
    >
      {editing ? (
        <textarea
          aria-label="编辑节点"
          className="mind-node__editor"
          placeholder={placeholder}
          ref={editorRef}
          rows={1}
          value={draft}
          onBlur={() => onCommitEdit(node.id, draft)}
          onChange={(event) => onDraftChange(event.target.value)}
          onCompositionEnd={() => {
            inputMethodComposingRef.current = false;
          }}
          onCompositionStart={() => {
            inputMethodComposingRef.current = true;
          }}
          onPaste={(event) => {
            const value = event.clipboardData.getData("text/plain");
            if (onPasteStructured(node.id, value)) {
              event.preventDefault();
            }
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (
              inputMethodComposingRef.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onCommitEdit(node.id, draft);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelEdit(node.id);
            }
          }}
        />
      ) : (
        <button
          aria-label={
            node.text.trim() ? undefined : emptyNodeLabel(layout)
          }
          aria-pressed={selected}
          className={`mind-node__content ${empty ? "is-placeholder" : ""}`}
          onClick={(event) =>
            onSelect(node.id, event.shiftKey || event.metaKey)
          }
          onDoubleClick={() => onBeginEdit(node.id)}
          type="button"
        >
          {empty ? placeholder : node.text}
        </button>
      )}
      {node.children.length > 0 && (
        <button
          aria-label={node.collapsed ? "展开分支" : "折叠分支"}
          className={`mind-node__disclosure ${node.collapsed ? "is-collapsed" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
          type="button"
        >
          <Icon name="chevron" size={13} />
        </button>
      )}
    </div>
  );
});
