import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FlowNode } from "../../types/mindmap";
import { trapDialogTab } from "../overlays/focus";

interface FlowTargetPickerProps {
  candidates: FlowNode[];
  onChoose: (nodeId: string) => void;
  onClose: () => void;
  sourceLabel: string;
}

const kindLabel = {
  start: "开始",
  step: "步骤",
  decision: "判断",
  end: "结束",
} as const;

const visibleOptionLimit = 20;

export function FlowTargetPicker({
  candidates,
  onChoose,
  onClose,
  sourceLabel,
}: FlowTargetPickerProps) {
  const titleId = useId();
  const listId = useId();
  const optionIdPrefix = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchableCandidates = useMemo(
    () => candidates.map((node) => ({
      node,
      searchableText: node.text.toLocaleLowerCase(),
    })),
    [candidates],
  );
  const result = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const items: FlowNode[] = [];
    let total = 0;
    searchableCandidates.forEach(({ node, searchableText }) => {
      if (normalized && !searchableText.includes(normalized)) return;
      total += 1;
      if (items.length < visibleOptionLimit) items.push(node);
    });
    return { items, total };
  }, [query, searchableCandidates]);

  useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, result.items.length - 1)));
  }, [result.items.length]);

  const activeOptionId = result.items[activeIndex]
    ? `${optionIdPrefix}-${result.items[activeIndex].id}`
    : undefined;

  return (
    <div
      className="overlay-backdrop flow-target-picker-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="flow-target-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          trapDialogTab(event, dialogRef);
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <p>流程汇合</p>
            <h2 id={titleId}>选择已有步骤</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </header>
        <p className="flow-target-picker__source">从“{sourceLabel || "未命名步骤"}”连接</p>
        <input
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded="true"
          aria-label="搜索已有步骤"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) =>
                result.items.length === 0
                  ? 0
                  : Math.min(result.items.length - 1, index + 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter" && result.items[activeIndex]) {
              event.preventDefault();
              onChoose(result.items[activeIndex].id);
            }
          }}
          placeholder="搜索步骤…"
          ref={inputRef}
          role="combobox"
          value={query}
        />
        <div
          aria-label="可汇合的步骤"
          className="flow-target-picker__list"
          id={listId}
          role="listbox"
        >
          {result.total === 0 ? (
            <div className="flow-target-picker__empty">没有可连接的步骤</div>
          ) : result.items.map((node, index) => (
            <button
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "is-active" : ""}
              id={`${optionIdPrefix}-${node.id}`}
              key={node.id}
              onClick={() => onChoose(node.id)}
              onPointerMove={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span>{node.text || "未命名步骤"}</span>
              <small>{kindLabel[node.kind]}</small>
            </button>
          ))}
        </div>
        {result.total > result.items.length && (
          <div
            aria-live="polite"
            className="flow-target-picker__truncation"
            role="status"
          >
            显示前 {result.items.length} 步，共 {result.total} 步；继续输入可缩小范围
          </div>
        )}
      </section>
    </div>
  );
}
