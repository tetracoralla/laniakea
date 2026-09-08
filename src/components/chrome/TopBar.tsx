import { createPortal } from "react-dom";
import { LanguageSettings } from "../settings/LanguageSettings";
import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { RecentDocument } from "../../persistence/recentDocuments";
import type { SaveState } from "../../types/mindmap";
import { Icon } from "../icons/Icon";
import { moveMenuFocus } from "../menu/menuKeyboard";
import {
  isInputMethodKey,
  markInputMethodComposition,
} from "../../model/inputMethod";
import { DocumentSwitcher } from "./DocumentSwitcher";
import { useColorTheme } from "../../hooks/useColorTheme";

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
  currentSourceDocumentPath?: string | null;
  recentDocuments: RecentDocument[];
  onOpenRecent: (path: string) => void;
  onRevealCurrent: (path: string) => void;
  onRevealRecent: (path: string) => void;
  onCopyDocumentPath: (path: string) => void;
  onMoveRecent: (path: string) => void;
  onForgetRecent: (path: string) => void;
  onDeleteDocument?: (path: string) => void;
  showDesktopActions?: boolean;
  onExportFullBackup?: () => void;
  onRestoreFullBackup?: () => void;
  spacePath?: Array<{ id: string; label: string }>;
  onNavigateBack?: () => void;
  saveState?: SaveState;
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
  currentSourceDocumentPath = null,
  recentDocuments,
  onOpenRecent,
  onRevealCurrent,
  onRevealRecent,
  onCopyDocumentPath,
  onMoveRecent,
  onForgetRecent,
  onDeleteDocument,
  showDesktopActions = true,
  onExportFullBackup,
  onRestoreFullBackup,
  spacePath = [],
  onNavigateBack,
  saveState = "saved",
}: TopBarProps) {
  useLocale();
  const { theme, toggleTheme } = useColorTheme();
  const [languageOpen, setLanguageOpen] = useState(false);
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
    const menu = menuRef.current;
    if (menu && moveMenuFocus(menu, event.key)) {
      event.preventDefault();
    }
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
            aria-label={t("返回上层图")}
            className="space-navigation__back"
            onClick={onNavigateBack}
            type="button"
          >
            <Icon name="chevron" size={16} />
          </button>
        )}
        <label className="document-title">
          <span className="sr-only">{t("文档标题")}</span>
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
          {(saveState === "saving" || saveState === "error") && (
            <span
              aria-label={
                saveState === "error" ? t("保存失败") : t("有未保存的更改")
              }
              className={`document-title__dirty${
                saveState === "error"
                  ? " document-title__dirty--error"
                  : ""
              }`}
              role="img"
              title={
                saveState === "error"
                  ? t("保存失败，可在左下角状态条重试")
                  : t("有未保存的更改")
              }
            />
          )}
        </label>
        <DocumentSwitcher
          currentPath={currentDocumentPath}
          currentSourcePath={currentSourceDocumentPath}
          currentTitle={title}
          onOpenChange={(open) =>
            setOpenMenu(open ? "documents" : null)
          }
          onOpenFile={onImport}
          onOpenRecent={onOpenRecent}
          onRevealCurrent={onRevealCurrent}
          onRevealRecent={onRevealRecent}
          onCopyDocumentPath={onCopyDocumentPath}
          onForgetRecent={onForgetRecent}
          onDeleteDocument={onDeleteDocument}
          onMoveRecent={onMoveRecent}
          open={openMenu === "documents"}
          recentDocuments={recentDocuments}
          showFileActions={showDesktopActions}
        />
        {currentSpace && (
          <div
            aria-label={t("当前位置：{0}", currentSpace.label)}
            className="space-navigation"
            title={currentSpace.label}
          >
            <span aria-hidden="true" className="space-navigation__separator" />
            <strong>{currentSpace.label}</strong>
          </div>
        )}
      </div>

      <nav className="topbar__actions" aria-label={t("文档操作")}>
        <button
          aria-label={t("新建")}
          className="toolbar-button toolbar-button--reveal"
          onClick={onNew}
          title={t("新建")}
          type="button"
        >
          <Icon name="file" />
          <span aria-hidden="true" className="toolbar-button__label">
            <span>{t("新建")}</span>
          </span>
        </button>
        <span
          aria-hidden="true"
          className="topbar__actions-divider"
        />
        <button
          aria-label={t("搜索")}
          className="toolbar-button"
          onClick={(event) => onSearch(event.currentTarget)}
          title={t("搜索")}
          type="button"
        >
          <Icon name="search" />
        </button>
        <button
          aria-label={t("另存为")}
          className="toolbar-button"
          onClick={onSaveAs}
          title={t("另存为")}
          type="button"
        >
          <Icon name="export" />
        </button>
        <div className="more-menu" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={t("更多")}
            className="toolbar-button"
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              setOpenMenu((value) =>
                value === "more" ? null : "more",
              );
            }}
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
            title={t("更多")}
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
                <span>{t("保存")}</span>
              </button>
              <button
                onClick={() => runMenuAction(onCopyMarkdown)}
                role="menuitem"
                type="button"
              >
                <Icon name="export" />
                <span>{t("复制为 Markdown")}</span>
              </button>
              {!showDesktopActions && onExportFullBackup && (
                <button
                  onClick={() => runMenuAction(onExportFullBackup)}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="export" />
                  <span>{t("导出完整备份")}</span>
                </button>
              )}
              {!showDesktopActions && onRestoreFullBackup && (
                <button
                  onClick={() => runMenuAction(onRestoreFullBackup)}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="folder" />
                  <span>{t("恢复完整备份")}</span>
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
                  <span>{t("唤醒快捷键")}</span>
                </button>
              )}
              <button
                aria-label="Language / 语言"
                onClick={() => runMenuAction(() => setLanguageOpen(true), false)}
                role="menuitem" type="button"
              >
                <span aria-hidden="true" className="language-menu-icon">文</span>
                <span>Language / 语言</span>
              </button>
              <button
                onClick={() => runMenuAction(toggleTheme)}
                role="menuitem"
                type="button"
              >
                <span aria-hidden="true" className="theme-swatch" />
                <span>{theme === "dark" ? t("切换到浅色模式") : t("切换到深色模式")}</span>
              </button>
            </div>
          )}
        </div>
      </nav>
      {languageOpen && createPortal(<LanguageSettings onClose={() => {
        setLanguageOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus({ preventScroll: true }));
      }} />, document.body)}
    </header>
  );
}
