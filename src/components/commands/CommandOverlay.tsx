import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  commandSupportsTarget,
  commandRegistry,
  type CommandDefinition,
  type CommandId,
  type CommandTarget,
} from "../../commands/registry";
import { displayShortcutParts } from "../../model/shortcutDisplay";
import type { MindMapDocument } from "../../types/mindmap";
import { findMindNode } from "../../model/spaces";
import { isInputMethodKey } from "../../model/inputMethod";
import { Icon } from "../icons/Icon";
import { usePagedResults, useRevealActiveOption } from "../../hooks/usePagedResults";
import { ResultPagination } from "../overlays/ResultPagination";
import { trapDialogTab } from "../overlays/focus";

export type OverlayMode = "commands" | "search";

interface CommandOverlayProps {
  mode: OverlayMode;
  document: MindMapDocument;
  commandTarget?: CommandTarget;
  onClose: () => void;
  onExecute: (id: CommandId) => void;
  onSelectNode: (id: string, spaceId?: string) => void;
}

interface OverlayItem {
  id: string;
  nodeId?: string;
  spaceId?: string;
  title: string;
  meta: string;
  metaKind: "context" | "shortcut";
  command?: CommandDefinition;
}

interface SearchEntry extends OverlayItem {
  normalizedTitle: string;
}

export const overlayItemLimit = 12;

export function CommandOverlay({
  mode,
  document,
  commandTarget = "mind-node",
  onClose,
  onExecute,
  onSelectNode,
}: CommandOverlayProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const listId = useId();

  const searchEntries = useMemo<SearchEntry[]>(() => {
    if (mode !== "search") return [];
    const entries: SearchEntry[] = [];
    const parentByNodeId = new Map<string, string>();
    Object.values(document.nodes).forEach((node) => {
      node.children.forEach((childId) => {
        parentByNodeId.set(childId, node.id);
      });
    });
    const ancestorTrail = (nodeId: string): string => {
      const trail: string[] = [];
      let cursor = parentByNodeId.get(nodeId);
      while (cursor && cursor !== document.rootId) {
        const parent = document.nodes[cursor];
        if (!parent) break;
        trail.unshift(parent.text.trim());
        cursor = parentByNodeId.get(cursor);
      }
      return trail.filter(Boolean).join(" · ");
    };
    Object.values(document.nodes).forEach((node) => {
      if (!node.text.trim()) return;
      const trail = ancestorTrail(node.id);
      entries.push({
        id: `map:${node.id}`,
        nodeId: node.id,
        title: node.text,
        normalizedTitle: node.text.toLocaleLowerCase(),
        meta: trail || (node.children.length ? `${node.children.length} 个子节点` : ""),
        metaKind: "context",
      });
    });
    Object.values(document.spaces ?? {}).forEach((space) => {
      const anchor = findMindNode(document, space.anchorNodeId);
      Object.values(space.nodes).forEach((node) => {
        if (!node.text.trim()) return;
        entries.push({
          id: `space:${space.id}:${node.id}`,
          nodeId: node.id,
          spaceId: space.id,
          title: node.text,
          normalizedTitle: node.text.toLocaleLowerCase(),
          meta: `${space.type === "map" ? "思维图" : "流程"} · ${anchor?.text || "未命名节点"}`,
          metaKind: "context",
        });
      });
    });
    return entries;
  }, [document.nodes, document.rootId, document.spaces, mode]);

  const matches = useMemo<OverlayItem[]>(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (mode === "commands") {
      const matches = commandRegistry
        .filter((command) => commandSupportsTarget(command, commandTarget))
        .filter(
          (command) =>
            !normalized ||
            command.label.toLocaleLowerCase().includes(normalized) ||
            command.group.toLocaleLowerCase().includes(normalized),
        )
        .map((command) => ({
          id: command.id,
          title: command.label,
          meta: command.shortcut,
          metaKind: "shortcut" as const,
          command,
        }));
      return matches;
    }

    return searchEntries.filter((entry) => !normalized || entry.normalizedTitle.includes(normalized));
  }, [commandTarget, mode, query, searchEntries]);
  const results = usePagedResults(matches, overlayItemLimit);
  const { activeIndex, pageStart, visibleItems: renderedItems } = results;
  const activeOptionId = results.activeItem ? `${listId}-option-${activeIndex}` : undefined;
  useRevealActiveOption(activeOptionId, matches);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setQuery("");
  }, [mode]);

  const choose = (item: OverlayItem | undefined) => {
    if (!item) return;
    // Close the current surface first so commands that open another overlay
    // win the same React batch instead of being cleared immediately after.
    onClose();
    if (item.command) onExecute(item.command.id);
    else if (item.nodeId) onSelectNode(item.nodeId, item.spaceId);
  };

  return (
    <div
      className="overlay-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={mode === "commands" ? "命令面板" : "搜索内容"}
        aria-modal="true"
        className="command-overlay"
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
        <div className="command-overlay__search">
          <Icon name={mode === "commands" ? "command" : "search"} />
          <input
            aria-activedescendant={activeOptionId}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-label={mode === "commands" ? "搜索命令" : "搜索内容"}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (isInputMethodKey(event.nativeEvent)) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                results.move(1);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                results.move(-1);
              }
              if (event.key === "PageDown" || event.key === "PageUp") {
                event.preventDefault();
                results.move(event.key === "PageDown" ? overlayItemLimit : -overlayItemLimit);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                choose(results.activeItem);
              }
            }}
            placeholder={mode === "commands" ? "输入命令…" : "搜索内容…"}
            ref={inputRef}
            role="combobox"
            value={query}
          />
          <kbd>Esc</kbd>
        </div>
        <div
          className="command-overlay__list"
          id={listId}
          role="listbox"
        >
          {results.total === 0 ? (
            <div className="command-overlay__empty">没有匹配结果</div>
          ) : (
            renderedItems.map((item, index) => (
              <button
                aria-selected={activeIndex === pageStart + index}
                className={activeIndex === pageStart + index ? "is-active" : ""}
                id={`${listId}-option-${pageStart + index}`}
                key={item.id}
                onClick={() => choose(item)}
                onPointerMove={() => results.select(pageStart + index)}
                role="option"
                type="button"
                title={item.title}
              >
                <span>
                  <strong>{item.title}</strong>
                  {item.command ? <small>{item.command.group}</small> : item.meta ? (
                    <small className="command-overlay__meta" title={item.meta}>{item.meta}</small>
                  ) : null}
                </span>
                {item.metaKind === "shortcut" ? (
                  <kbd>{displayShortcutParts(item.meta.split("+"))}</kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
        <ResultPagination start={pageStart} count={renderedItems.length} total={results.total}
          onPrevious={() => { results.previousPage(); inputRef.current?.focus({ preventScroll: true }); }}
          onNext={() => { results.nextPage(); inputRef.current?.focus({ preventScroll: true }); }} />
      </section>
    </div>
  );
}
