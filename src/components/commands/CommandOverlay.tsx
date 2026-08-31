import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  commandRegistry,
  type CommandDefinition,
  type CommandId,
} from "../../commands/registry";
import type { MindMapDocument } from "../../types/mindmap";
import { findMindNode } from "../../model/spaces";
import { Icon } from "../icons/Icon";
import { trapDialogTab } from "../overlays/focus";

export type OverlayMode = "commands" | "search";

interface CommandOverlayProps {
  mode: OverlayMode;
  document: MindMapDocument;
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

export function moveOverlayIndex(
  current: number,
  delta: -1 | 1,
  renderedCount: number,
): number {
  return Math.max(
    0,
    Math.min(Math.max(0, renderedCount - 1), current + delta),
  );
}

export function CommandOverlay({
  mode,
  document,
  onClose,
  onExecute,
  onSelectNode,
}: CommandOverlayProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
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
  }, [document.nodes, document.spaces, mode]);

  const result = useMemo<{
    items: OverlayItem[];
    total: number;
  }>(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (mode === "commands") {
      const matches = commandRegistry
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
      return {
        items: matches.slice(0, overlayItemLimit),
        total: matches.length,
      };
    }

    const items: OverlayItem[] = [];
    let total = 0;
    searchEntries.forEach((entry) => {
      if (normalized && !entry.normalizedTitle.includes(normalized)) return;
      total += 1;
      if (items.length < overlayItemLimit) items.push(entry);
    });
    return { items, total };
  }, [mode, query, searchEntries]);
  const renderedItems = result.items;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => setActiveIndex(0), [query, mode]);

  const choose = (item: OverlayItem | undefined) => {
    if (!item) return;
    if (item.command) onExecute(item.command.id);
    else if (item.nodeId) onSelectNode(item.nodeId, item.spaceId);
    onClose();
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
        onKeyDown={(event) => trapDialogTab(event, dialogRef)}
        ref={dialogRef}
        role="dialog"
      >
        <div className="command-overlay__search">
          <Icon name={mode === "commands" ? "command" : "search"} />
          <input
            aria-activedescendant={
              renderedItems[activeIndex]
                ? `${listId}-option-${activeIndex}`
                : undefined
            }
            aria-controls={listId}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-label={mode === "commands" ? "搜索命令" : "搜索内容"}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) =>
                  moveOverlayIndex(index, 1, renderedItems.length),
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) =>
                  moveOverlayIndex(index, -1, renderedItems.length),
                );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                choose(renderedItems[activeIndex]);
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
          {result.total === 0 ? (
            <div className="command-overlay__empty">没有匹配结果</div>
          ) : (
            renderedItems.map((item, index) => (
              <button
                aria-selected={activeIndex === index}
                className={activeIndex === index ? "is-active" : ""}
                id={`${listId}-option-${index}`}
                key={item.id}
                onClick={() => choose(item)}
                onPointerMove={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span>
                  <strong>{item.title}</strong>
                  {item.command && <small>{item.command.group}</small>}
                </span>
                {item.metaKind === "shortcut" ? (
                  <kbd>
                    {item.meta.replaceAll("Meta", "⌘").replaceAll("+", "")}
                  </kbd>
                ) : item.meta ? (
                  <small className="command-overlay__meta">{item.meta}</small>
                ) : null}
              </button>
            ))
          )}
        </div>
        {result.total > renderedItems.length && (
          <div className="command-overlay__truncation" role="status">
            显示前 {renderedItems.length} 条，共 {result.total} 条
          </div>
        )}
      </section>
    </div>
  );
}
