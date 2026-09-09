import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import {
  memo,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEventHandler,
} from "react";
import {
  emptyNodeLabel,
  isMarkdownThematicBreak,
  nodePlaceholder,
} from "../../model/canvasRender";
import type { BranchTone, LayoutNode, MindNode } from "../../types/mindmap";
import {
  isInputMethodKey,
  markInputMethodComposition,
} from "../../model/inputMethod";
import { useTextEditorHistory } from "../../hooks/useTextEditorHistory";
import { nodeInlinePadding } from "../../model/layout";
import { Icon } from "../icons/Icon";

interface MindMapNodeProps {
  darkTone?: BranchTone;
  node: MindNode;
  layout: LayoutNode;
  selected: boolean;
  primary: boolean;
  editing: boolean;
  draft: string;
  onSelect: (id: string, additive: boolean) => void;
  onBeginEdit: (id: string) => void;
  onDraftChange: (value: string) => void;
  onPasteStructured: (id: string, value: string) => boolean;
  onCommitEdit: (id: string, value: string) => void;
  onCancelEdit: (id: string) => void;
  onEditTab?: (id: string, value: string, shiftKey: boolean) => void;
  onToggle: (id: string) => void;
  onOpenContextMenu?: (
    id: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
  ) => void;
  onDragPointerDown: PointerEventHandler<HTMLDivElement>;
}

export const MindMapNode = memo(function MindMapNode({
  darkTone,
  node,
  layout,
  selected,
  primary,
  editing,
  draft,
  onSelect,
  onBeginEdit,
  onDraftChange,
  onPasteStructured,
  onCommitEdit,
  onCancelEdit,
  onEditTab,
  onToggle,
  onOpenContextMenu = () => undefined,
  onDragPointerDown,
}: MindMapNodeProps) {
  useLocale();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const inputMethodComposingRef = useRef(false);
  const commitAfterCompositionRef = useRef(false);
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
    markInputMethodComposition(editor, true);
    editor.style.width = "100%";
    const visibleWidth = Math.max(editor.clientWidth, editor.scrollWidth);
    if (visibleWidth > 0) {
      editor.style.width = `${Math.ceil(visibleWidth)}px`;
    }
    editor.scrollLeft = 0;
  };

  const finishCompositionContext = (editor: HTMLTextAreaElement) => {
    markInputMethodComposition(editor, false);
    editor.style.removeProperty("width");
    editor.scrollLeft = 0;
  };

  const editorHistory = useTextEditorHistory({
    active: editing,
    editorRef,
    onRestore: onDraftChange,
    onRestored: fitEditorToText,
    sessionKey: editing ? node.id : null,
  });

  useLayoutEffect(() => {
    if (!editing) return;
    const editor = editorRef.current;
    if (!editor) return;
    fitEditorToText(editor);
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(editor.value.length, editor.value.length);
    editor.scrollTop = editor.scrollHeight;
    editorHistory.reset(editor);
  }, [editing, editorHistory.reset]);

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
      className={`mind-node mind-node--${layout.rootKind === "main" ? "root" : layout.rootKind === "floating" ? "floating" : layout.depth === 1 ? "branch" : layout.depth === 2 ? "secondary" : "leaf"} mind-node--${layout.tone} ${markdownDivider ? "is-markdown-divider" : ""} ${selected ? "is-selected" : ""} ${primary ? "is-primary" : ""} ${editing ? "is-editing" : ""}`}
      data-node-id={node.id}
      data-dark-tone={darkTone}
      id={`mind-node-${node.id}`}
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
      style={
        {
          "--node-padding-inline": `${nodeInlinePadding(layout.depth, layout.rootKind)}px`,
          left: layout.x,
          top: layout.y,
          width: layout.width,
          height: layout.height,
        } as CSSProperties
      }
    >
      {editing ? (
        <div className="mind-node__editor-shell">
          <textarea
            aria-label={t("编辑节点")}
            className="mind-node__editor"
            defaultValue={draft}
            placeholder={placeholder}
            ref={editorRef}
            rows={1}
            onBlur={(event) => {
              if (inputMethodComposingRef.current) {
                commitAfterCompositionRef.current = true;
                return;
              }
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
              editorHistory.record(editor);
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
              editorHistory.record(event.currentTarget);
              onDraftChange(event.currentTarget.value);
              if (commitAfterCompositionRef.current) {
                commitAfterCompositionRef.current = false;
                onCommitEdit(node.id, event.currentTarget.value);
              }
            }}
            onCompositionStart={(event) => {
              inputMethodComposingRef.current = true;
              commitAfterCompositionRef.current = false;
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
                isInputMethodKey(
                  event.nativeEvent,
                  inputMethodComposingRef.current,
                )
              ) {
                return;
              }
              if (editorHistory.handleKeyDown(event)) return;
              if (event.key === "Tab") {
                event.preventDefault();
                onEditTab?.(
                  node.id,
                  event.currentTarget.value,
                  event.shiftKey,
                );
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
              ? t("Markdown 分隔线")
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
      {(node.children.length > 0 || node.subspaceId) && (
        <button
          aria-label={node.collapsed ? t("展开分支") : t("折叠分支")}
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
