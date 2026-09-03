import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { RecentDocument } from "../../persistence/recentDocuments";
import { Icon } from "../icons/Icon";
import {
  isInputMethodKey,
  markInputMethodComposition,
} from "../../model/inputMethod";
import { DocumentSwitcher } from "./DocumentSwitcher";

interface TopBarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onTitleDraftChange?: (title: string) => void;
  onTitleDraftFinish?: (cancelled: boolean) => void;
  onSearch: (returnFocus: HTMLElement) => void;
  onNew: () => void;
  onImport: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCopyMarkdown: () => void;
  onShortcutSettings: (returnFocus: HTMLElement) => void;
  currentDocumentPath: string | null;
  recentDocuments: RecentDocument[];
  onOpenRecent: (path: string) => void;
  onRevealRecent: (path: string) => void;
  onCopyRecentPath: (path: string) => void;
  onMoveRecent: (path: string) => void;
  onForgetRecent: (path: string) => void;
  onDeleteDocument?: (path: string) => void;
  showDesktopActions?: boolean;
  onExportFullBackup?: () => void;
  onRestoreFullBackup?: () => void;
  spacePath?: Array<{ id: string; label: string; typeLabel: string }>;
  onNavigateBack?: () => void;
}

export function TopBar({
  title,
  onTitleChange,
  onTitleDraftChange = () => undefined,
  onTitleDraftFinish = () => undefined,
  onSearch,
  onNew,
  onImport,
  onSave,
  onSaveAs,
  onCopyMarkdown,
  onShortcutSettings,
  currentDocumentPath,
  recentDocuments,
  onOpenRecent,
  onRevealRecent,
  onCopyRecentPath,
  onMoveRecent,
  onForgetRecent,
  onDeleteDocument,
  showDesktopActions = true,
  onExportFullBackup,
  onRestoreFullBackup,
  spacePath = [],
  onNavigateBack,
}: TopBarProps) {
  const [draft, setDraft] = useState(title);
  const [openMenu, setOpenMenu] = useState<"documents" | "more" | null>(
    null,
  );
  const menuOpen = openMenu === "more";
  const currentSpace = spacePath[spacePath.length - 1];
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const composingTitleRef = useRef(false);
  const cancelTitleRef = useRef(false);

  useEffect(() => setDraft(title), [title]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (
        menuOpen &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [menuOpen]);

  const menuItems = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitem']",
      ) ?? [],
    );

  const focusMenuItem = (position: "first" | "last") => {
    window.requestAnimationFrame(() => {
      const items = menuItems();
      items[position === "first" ? 0 : items.length - 1]?.focus();
    });
  };

  const openMenuAt = (position: "first" | "last") => {
    setOpenMenu("more");
    focusMenuItem(position);
  };

  const closeMenu = (restore = true) => {
    setOpenMenu(null);
    if (restore) {
      window.requestAnimationFrame(() =>
        menuButtonRef.current?.focus({ preventScroll: true }),
      );
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      setOpenMenu(null);
      return;
    }
    if (
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
      items.length === 0
    ) {
      return;
    }
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (Math.max(index, -1) + 1) % items.length
            : (index <= 0 ? items.length : index) - 1;
    items[nextIndex]?.focus();
  };

  const runMenuAction = (
    action: () => void,
    restoreMenuFocus = true,
  ) => {
    closeMenu(restoreMenuFocus);
    action();
  };

  const finishTitle = (value: string) => {
    if (cancelTitleRef.current) {
      cancelTitleRef.current = false;
      setDraft(title);
      onTitleDraftFinish(true);
      return;
    }
    if (value.trim() !== title) onTitleChange(value);
    else setDraft(title);
    onTitleDraftFinish(false);
  };

  return (
    <header className="topbar">
      <div className="topbar__identity">
        {spacePath.length > 0 && onNavigateBack && (
          <button
            aria-label="返回上层图"
            className="space-navigation__back"
            onClick={onNavigateBack}
            type="button"
          >
            <Icon name="chevron" size={16} />
          </button>
        )}
        <label className="document-title">
          <span className="sr-only">文档标题</span>
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (!composingTitleRef.current) {
                onTitleDraftChange(event.target.value);
              }
            }}
            onBlur={(event) => finishTitle(event.currentTarget.value)}
            onCompositionEnd={(event) => {
              composingTitleRef.current = false;
              markInputMethodComposition(event.currentTarget, false);
              setDraft(event.currentTarget.value);
              onTitleDraftChange(event.currentTarget.value);
            }}
            onCompositionStart={(event) => {
              composingTitleRef.current = true;
              cancelTitleRef.current = false;
              markInputMethodComposition(event.currentTarget, true);
            }}
            onFocus={() => {
              cancelTitleRef.current = false;
            }}
            onKeyDown={(event) => {
              if (isInputMethodKey(event.nativeEvent, composingTitleRef.current)) return;
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                cancelTitleRef.current = true;
                setDraft(title);
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <DocumentSwitcher
          currentPath={currentDocumentPath}
          onOpenChange={(open) =>
            setOpenMenu(open ? "documents" : null)
          }
          onOpenFile={onImport}
          onOpenRecent={onOpenRecent}
          onRevealRecent={onRevealRecent}
          onCopyRecentPath={onCopyRecentPath}
          onForgetRecent={onForgetRecent}
          onDeleteDocument={onDeleteDocument}
          onMoveRecent={onMoveRecent}
          open={openMenu === "documents"}
          recentDocuments={recentDocuments}
          showFileActions={showDesktopActions}
        />
        {currentSpace && (
          <div
            aria-label={`当前位置：${currentSpace.typeLabel} ${currentSpace.label}`}
            className="space-navigation"
            title={`${currentSpace.typeLabel} · ${currentSpace.label}`}
          >
            <span aria-hidden="true" className="space-navigation__separator" />
            <strong>{currentSpace.label}</strong>
            <span className="space-navigation__type">{currentSpace.typeLabel}</span>
          </div>
        )}
      </div>

      <nav className="topbar__actions" aria-label="文档操作">
        <button
          aria-label="新建"
          className="toolbar-button toolbar-button--labeled"
          onClick={onNew}
          title="新建"
          type="button"
        >
          <Icon name="file" />
          <span>新建</span>
        </button>
        <span
          aria-hidden="true"
          className="topbar__actions-divider"
        />
        <button
          aria-label="搜索"
          className="toolbar-button"
          onClick={(event) => onSearch(event.currentTarget)}
          title="搜索"
          type="button"
        >
          <Icon name="search" />
        </button>
        <button
          aria-label="另存为"
          className="toolbar-button"
          onClick={onSaveAs}
          title="另存为"
          type="button"
        >
          <Icon name="export" />
        </button>
        <div className="more-menu" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="更多"
            className="toolbar-button"
            onClick={() =>
              setOpenMenu((value) =>
                value === "more" ? null : "more",
              )
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                openMenuAt("first");
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                openMenuAt("last");
              } else if (event.key === "Escape" && menuOpen) {
                event.preventDefault();
                closeMenu();
              }
            }}
            ref={menuButtonRef}
            title="更多"
            type="button"
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <div
              className="menu-popover"
              onKeyDown={handleMenuKeyDown}
              role="menu"
            >
              <button
                onClick={() => runMenuAction(onSave)}
                role="menuitem"
                type="button"
              >
                <Icon name="file" />
                <span>保存</span>
              </button>
              <button
                onClick={() => runMenuAction(onCopyMarkdown)}
                role="menuitem"
                type="button"
              >
                <Icon name="export" />
                <span>复制为 Markdown</span>
              </button>
              {!showDesktopActions && onExportFullBackup && (
                <button
                  onClick={() => runMenuAction(onExportFullBackup)}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="export" />
                  <span>导出完整备份</span>
                </button>
              )}
              {!showDesktopActions && onRestoreFullBackup && (
                <button
                  onClick={() => runMenuAction(onRestoreFullBackup)}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="folder" />
                  <span>恢复完整备份</span>
                </button>
              )}
              {showDesktopActions && (
                <button
                  onClick={() =>
                    runMenuAction(() => {
                      if (menuButtonRef.current) {
                        onShortcutSettings(menuButtonRef.current);
                      }
                    }, false)
                  }
                  role="menuitem"
                  type="button"
                >
                  <Icon name="command" />
                  <span>唤醒快捷键</span>
                </button>
              )}
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
