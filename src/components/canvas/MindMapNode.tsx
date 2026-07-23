import { memo, useEffect, useRef } from "react";
import type { LayoutNode, MindNode } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface MindMapNodeProps {
  node: MindNode;
  layout: LayoutNode;
  selected: boolean;
  primary: boolean;
  editing: boolean;
  draft: string;
  onSelect: (id: string, additive: boolean) => void;
  onBeginEdit: (id: string) => void;
  onDraftChange: (value: string) => void;
  onCommitEdit: (id: string, value: string) => void;
  onCancelEdit: (id: string) => void;
  onToggle: (id: string) => void;
}

export const MindMapNode = memo(function MindMapNode({
  node,
  layout,
  selected,
  primary,
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
  }, [editing]);

  return (
    <div
      className={`mind-node mind-node--${layout.depth === 0 ? "root" : layout.depth === 1 ? "branch" : "leaf"} mind-node--${layout.tone} ${selected ? "is-selected" : ""} ${primary ? "is-primary" : ""}`}
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
          placeholder={
            node.parentId === null ? "输入中心主题" : "输入节点内容"
          }
          ref={editorRef}
          rows={1}
          value={draft}
          onBlur={() => onCommitEdit(node.id, draft)}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
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
          aria-pressed={selected}
          className="mind-node__content"
          onClick={(event) =>
            onSelect(node.id, event.shiftKey || event.metaKey)
          }
          onDoubleClick={() => onBeginEdit(node.id)}
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
