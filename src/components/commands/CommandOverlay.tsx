import { useEffect, useMemo, useRef, useState } from "react";
import {
  commandRegistry,
  type CommandDefinition,
  type CommandId,
} from "../../commands/registry";
import type { MindMapDocument } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

export type OverlayMode = "commands" | "search";

interface CommandOverlayProps {
  mode: OverlayMode;
  document: MindMapDocument;
  onClose: () => void;
  onExecute: (id: CommandId) => void;
  onSelectNode: (id: string) => void;
}

interface OverlayItem {
  id: string;
  title: string;
  meta: string;
  command?: CommandDefinition;
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

  const items = useMemo<OverlayItem[]>(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (mode === "commands") {
      return commandRegistry
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
          command,
        }));
    }

    return Object.values(document.nodes)
      .filter((node) => {
        if (!normalized) return true;
        return node.text.toLocaleLowerCase().includes(normalized);
      })
      .map((node) => ({
        id: node.id,
        title: node.text,
        meta: node.children.length ? `${node.children.length} 个子节点` : "节点",
      }));
  }, [document.nodes, mode, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => setActiveIndex(0), [query, mode]);

  const choose = (item: OverlayItem | undefined) => {
    if (!item) return;
    if (item.command) onExecute(item.command.id);
    else onSelectNode(item.id);
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
        aria-label={mode === "commands" ? "命令面板" : "搜索节点"}
        aria-modal="true"
        className="command-overlay"
        role="dialog"
      >
        <div className="command-overlay__search">
          <Icon name={mode === "commands" ? "command" : "search"} />
          <input
            aria-label={mode === "commands" ? "搜索命令" : "搜索节点"}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) =>
                  Math.min(items.length - 1, index + 1),
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                choose(items[activeIndex]);
              }
            }}
            placeholder={mode === "commands" ? "输入命令…" : "输入节点内容…"}
            ref={inputRef}
            value={query}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-overlay__list" role="listbox">
          {items.length === 0 ? (
            <div className="command-overlay__empty">没有匹配结果</div>
          ) : (
            items.slice(0, 12).map((item, index) => (
              <button
                aria-selected={activeIndex === index}
                className={activeIndex === index ? "is-active" : ""}
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
                <kbd>{item.meta.replaceAll("Meta", "⌘").replaceAll("+", "")}</kbd>
              </button>
            ))
          )}
        </div>
        <footer className="command-overlay__footer">
          <span>
            <kbd>↑↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
        </footer>
      </section>
    </div>
  );
}
