import {
  memo,
  useLayoutEffect,
  useRef,
  type PointerEventHandler,
} from "react";
import {
  emptyNodeLabel,
  isMarkdownThematicBreak,
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
  onOpenContextMenu?: (
    id: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
  ) => void;
  onOpenSubspace?: (id: string) => void;
  portalSummary?: string;
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
  onOpenContextMenu = () => undefined,
  onOpenSubspace = () => undefined,
  portalSummary,
  onDragPointerDown,
}: MindMapNodeProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const inputMethodComposingRef = useRef(false);
  const placeholder = nodePlaceholder(layout);
  const empty = node.text.length === 0;
  const markdownDivider = isMarkdownThematicBreak(node.text);

  const fitEditorToText = (editor: HTMLTextAreaElement) => {
    const previousScrollTop = editor.scrollTop;
    const selectionAtEnd = editor.selectionEnd === editor.value.length;
    const lineHeight = Number.parseFloat(
      editor.ownerDocument.defaultView?.getComputedStyle(editor)
        .lineHeight ?? "",
    );
    editor.style.height = "0px";
    const scrollHeight = editor.scrollHeight;
    if (lineHeight > 0 && scrollHeight > 0) {
      editor.style.height =
        scrollHeight > lineHeight * 1.5 ? "100%" : `${lineHeight}px`;
      editor.scrollTop = selectionAtEnd
        ? editor.scrollHeight
        : previousScrollTop;
      return;
    }
    editor.style.height = "1.35em";
    editor.scrollTop = selectionAtEnd
      ? editor.scrollHeight
      : previousScrollTop;
  };

  const revealCompositionContext = (editor: HTMLTextAreaElement) => {
    editor.dataset.composing = "true";
    editor.style.width = "100%";
    const visibleWidth = Math.max(editor.clientWidth, editor.scrollWidth);
    if (visibleWidth > 0) {
      editor.style.width = `${Math.ceil(visibleWidth)}px`;
    }
    editor.scrollLeft = 0;
  };

  const finishCompositionContext = (editor: HTMLTextAreaElement) => {
    delete editor.dataset.composing;
    editor.style.removeProperty("width");
    editor.scrollLeft = 0;
  };

  useLayoutEffect(() => {
    if (!editing) return;
    const editor = editorRef.current;
    if (!editor) return;
    fitEditorToText(editor);
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(editor.value.length, editor.value.length);
    editor.scrollTop = editor.scrollHeight;
  }, [editing]);

  useLayoutEffect(() => {
    if (!editing) return;
    const editor = editorRef.current;
    if (!editor || editor.selectionEnd !== editor.value.length) return;
    const keepCaretVisible = () => {
      if (editor.selectionEnd === editor.value.length) {
        editor.scrollTop = editor.scrollHeight;
      }
    };
    keepCaretVisible();
    const view = editor.ownerDocument.defaultView;
    const frame = view?.requestAnimationFrame(keepCaretVisible);
    return () => {
      if (frame !== undefined) view?.cancelAnimationFrame(frame);
    };
  }, [draft, editing, layout.height]);

  return (
    <div
      className={`mind-node mind-node--${layout.rootKind === "main" ? "root" : layout.rootKind === "floating" ? "floating" : layout.depth === 1 ? "branch" : "leaf"} mind-node--${layout.tone} ${markdownDivider ? "is-markdown-divider" : ""} ${selected ? "is-selected" : ""} ${primary ? "is-primary" : ""} ${editing ? "is-editing" : ""} ${dragging ? "is-dragging" : ""} ${dropTarget ? "is-drop-target" : ""}`}
      data-node-id={node.id}
      onContextMenu={
        editing
          ? undefined
          : (event) => {
              event.preventDefault();
              event.stopPropagation();
              const returnFocus =
                event.currentTarget.querySelector<HTMLElement>(
                  ".mind-node__content",
                ) ?? event.currentTarget;
              const bounds = event.currentTarget.getBoundingClientRect();
              onOpenContextMenu(node.id, {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
              }, returnFocus);
            }
      }
      onPointerDown={onDragPointerDown}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
    >
      {editing ? (
        <div className="mind-node__editor-shell">
          <textarea
            aria-label="编辑节点"
            className="mind-node__editor"
            defaultValue={draft}
            placeholder={placeholder}
            ref={editorRef}
            rows={1}
            onBlur={(event) => {
              inputMethodComposingRef.current = false;
              finishCompositionContext(event.currentTarget);
              onCommitEdit(node.id, event.currentTarget.value);
            }}
            onChange={(event) => {
              const editor = event.currentTarget;
              if (
                inputMethodComposingRef.current ||
                (event.nativeEvent as InputEvent).isComposing
              ) {
                revealCompositionContext(editor);
                return;
              }
              const selectionAtEnd = editor.selectionEnd === editor.value.length;
              fitEditorToText(editor);
              onDraftChange(editor.value);
              if (selectionAtEnd) {
                editor.ownerDocument.defaultView?.setTimeout(() => {
                  if (
                    editor.isConnected &&
                    editor.selectionEnd === editor.value.length
                  ) {
                    editor.scrollTop = editor.scrollHeight;
                  }
                }, 0);
              }
            }}
            onCompositionEnd={(event) => {
              inputMethodComposingRef.current = false;
              finishCompositionContext(event.currentTarget);
              fitEditorToText(event.currentTarget);
              onDraftChange(event.currentTarget.value);
            }}
            onCompositionStart={(event) => {
              inputMethodComposingRef.current = true;
              revealCompositionContext(event.currentTarget);
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
                onCommitEdit(node.id, event.currentTarget.value);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelEdit(node.id);
              }
            }}
          />
        </div>
      ) : (
        <button
          aria-label={
            markdownDivider
              ? "Markdown 分隔线"
              : node.text.trim()
                ? undefined
                : emptyNodeLabel(layout)
          }
          aria-pressed={selected}
          className={`mind-node__content ${empty ? "is-placeholder" : ""}`}
          onClick={(event) =>
            onSelect(node.id, event.shiftKey || event.metaKey)
          }
          onDoubleClick={() => onBeginEdit(node.id)}
          type="button"
        >
          {markdownDivider ? (
            <span aria-hidden="true" className="mind-node__divider" />
          ) : empty ? (
            placeholder
          ) : (
            node.text
          )}
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
      {node.subspaceId && (
        <button
          aria-label={`进入${portalSummary ?? "下层图"}`}
          className="mind-node__portal"
          onClick={(event) => {
            event.stopPropagation();
            onOpenSubspace(node.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          title={portalSummary ?? "进入下层图"}
          type="button"
        >
          <Icon name="layers" size={14} />
        </button>
      )}
    </div>
  );
});
