import { useEffect, useRef } from "react";
import type { LayoutNode, MindNode } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface MindMapNodeProps {
  node: MindNode;
  layout: LayoutNode;
  selected: boolean;
  editing: boolean;
  draft: string;
  onSelect: () => void;
  onBeginEdit: () => void;
  onDraftChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onToggle: () => void;
}

export function MindMapNode({
  node,
  layout,
  selected,
  editing,
  draft,
  onSelect,
  onBeginEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  onToggle,
}: MindMapNodeProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    editorRef.current?.focus();
    editorRef.current?.setSelectionRange(draft.length, draft.length);
  }, [editing, draft.length]);

  return (
    <div
      className={`mind-node mind-node--${layout.depth === 0 ? "root" : layout.depth === 1 ? "branch" : "leaf"} mind-node--${layout.tone} ${selected ? "is-selected" : ""}`}
      data-node-id={node.id}
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
          ref={editorRef}
          rows={1}
          value={draft}
          onBlur={onCommitEdit}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onCommitEdit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelEdit();
            }
          }}
        />
      ) : (
        <button
          aria-current={selected ? "true" : undefined}
          className="mind-node__content"
          onClick={onSelect}
          onDoubleClick={onBeginEdit}
          type="button"
        >
          {node.text}
        </button>
      )}
      {node.children.length > 0 && (
        <button
          aria-label={node.collapsed ? "展开分支" : "折叠分支"}
          className={`mind-node__disclosure ${node.collapsed ? "is-collapsed" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          type="button"
        >
          <Icon name="chevron" size={13} />
        </button>
      )}
    </div>
  );
}
