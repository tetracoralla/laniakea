import { useEffect, useRef, useState } from "react";
import type { SaveState } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface TopBarProps {
  title: string;
  saveState: SaveState;
  onTitleChange: (title: string) => void;
  onSearch: () => void;
  onExport: () => void;
  onNew: () => void;
  onImport: () => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
}

export function TopBar({
  title,
  saveState,
  onTitleChange,
  onSearch,
  onExport,
  onNew,
  onImport,
  onExportMarkdown,
  onExportJson,
}: TopBarProps) {
  const [draft, setDraft] = useState(title);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(title), [title]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const commitTitle = () => {
    if (draft.trim() !== title) onTitleChange(draft);
    else setDraft(title);
  };

  return (
    <header className="topbar">
      <div className="topbar__identity">
        <div className="brand" aria-label="原点">
          <span className="brand__mark" />
          <span className="brand__name">原点</span>
        </div>
        <span className="topbar__divider" />
        <label className="document-title">
          <span className="sr-only">文档标题</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(title);
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <span className="save-state" aria-live="polite">
          <span
            className={`save-state__dot ${
              saveState === "saving" ? "is-saving" : ""
            }`}
          />
          {saveState === "saving" ? "正在保存" : "已保存到本地"}
        </span>
      </div>

      <nav className="topbar__actions" aria-label="文档操作">
        <button className="toolbar-button" onClick={onSearch} type="button">
          <Icon name="search" />
          <span>搜索</span>
          <kbd>⌘F</kbd>
        </button>
        <span className="topbar__divider topbar__divider--short" />
        <button className="toolbar-button" onClick={onExport} type="button">
          <Icon name="export" />
          <span>导出</span>
          <kbd>⇧⌘C</kbd>
        </button>
        <span className="topbar__divider topbar__divider--short" />
        <div className="more-menu" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="更多"
            className="icon-button icon-button--more"
            onClick={() => setMenuOpen((value) => !value)}
            type="button"
          >
            <Icon name="more" />
            <span>更多</span>
          </button>
          {menuOpen && (
            <div className="menu-popover" role="menu">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onNew();
                }}
                role="menuitem"
                type="button"
              >
                <Icon name="file" />
                <span>新建思维导图</span>
                <kbd>⌘N</kbd>
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onImport();
                }}
                role="menuitem"
                type="button"
              >
                <Icon name="folder" />
                <span>导入 Markdown</span>
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onExportMarkdown();
                }}
                role="menuitem"
                type="button"
              >
                <Icon name="export" />
                <span>导出 Markdown 文件</span>
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onExportJson();
                }}
                role="menuitem"
                type="button"
              >
                <Icon name="code" />
                <span>导出原生文件</span>
              </button>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
