import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FlowNode } from "../../types/mindmap";
import { isInputMethodKey } from "../../model/inputMethod";
import { trapDialogTab } from "../overlays/focus";
import { usePagedResults, useRevealActiveOption } from "../../hooks/usePagedResults";
import { ResultPagination } from "../overlays/ResultPagination";
import { Icon } from "../icons/Icon";

interface FlowTargetPickerProps {
  candidates: FlowNode[];
  description?: string;
  eyebrow?: string;
  listLabel?: string;
  onChoose: (nodeId: string) => void;
  onClose: () => void;
  sourceLabel: string;
  title?: string;
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
  description,
  eyebrow = t("流程汇合"),
  listLabel = t("可汇合的步骤"),
  onChoose,
  onClose,
  sourceLabel,
  title = t("选择已有步骤"),
}: FlowTargetPickerProps) {
  useLocale();
  const titleId = useId();
  const listId = useId();
  const optionIdPrefix = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const searchableCandidates = useMemo(
    () => candidates.map((node) => ({
      node,
      searchableText: node.text.toLocaleLowerCase(),
    })),
    [candidates],
  );
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return searchableCandidates.filter(({ searchableText }) => !normalized || searchableText.includes(normalized)).map(({ node }) => node);
  }, [query, searchableCandidates]);
  const results = usePagedResults(matches, visibleOptionLimit);
  const { activeIndex, pageStart, visibleItems } = results;

  useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);
  const activeOptionId = results.activeItem ? `${optionIdPrefix}-${results.activeItem.id}` : undefined;
  useRevealActiveOption(activeOptionId, matches);

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
          if (isInputMethodKey(event.nativeEvent)) return;
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
            <p>{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button aria-label={t("关闭")} onClick={onClose} type="button">
            <Icon aria-hidden="true" name="close" size={16} />
          </button>
        </header>
        <p className="flow-target-picker__source">
          {description ?? t("从“{0}”连接", sourceLabel || t("未命名步骤"))}
        </p>
        <input
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded="true"
          aria-label={t("搜索已有步骤")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (isInputMethodKey(event.nativeEvent)) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              results.move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              results.move(-1);
            } else if (event.key === "PageDown" || event.key === "PageUp") {
              event.preventDefault();
              results.move(event.key === "PageDown" ? visibleOptionLimit : -visibleOptionLimit);
            } else if (event.key === "Enter" && results.activeItem) {
              event.preventDefault();
              onChoose(results.activeItem.id);
            }
          }}
          placeholder={t("搜索步骤…")}
          ref={inputRef}
          role="combobox"
          value={query}
        />
        <div
          aria-label={listLabel}
          className="flow-target-picker__list"
          id={listId}
          role="listbox"
        >
          {results.total === 0 ? (
            <div className="flow-target-picker__empty">{t("没有可连接的步骤")}</div>
          ) : visibleItems.map((node, index) => (
            <button
              aria-selected={activeIndex === pageStart + index}
              className={activeIndex === pageStart + index ? "is-active" : ""}
              id={`${optionIdPrefix}-${node.id}`}
              key={node.id}
              onClick={() => onChoose(node.id)}
              onPointerMove={() => results.select(pageStart + index)}
              role="option"
              type="button"
            >
              <span title={node.text}>{node.text || t("未命名步骤")}</span>
              <small>{t(kindLabel[node.kind])}</small>
            </button>
          ))}
        </div>
        <ResultPagination start={pageStart} count={visibleItems.length} total={results.total}
          onPrevious={() => { results.previousPage(); inputRef.current?.focus({ preventScroll: true }); }}
          onNext={() => { results.nextPage(); inputRef.current?.focus({ preventScroll: true }); }} />
      </section>
    </div>
  );
}
