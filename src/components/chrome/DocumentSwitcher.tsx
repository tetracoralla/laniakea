import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  describeCurrentDocument,
  isInternalDocumentPath,
  recentDocumentLocation,
  visibleRecentDocuments,
  type RecentDocument,
} from "../../persistence/recentDocuments";
import { Icon } from "../icons/Icon";
import { moveMenuFocus } from "../menu/menuKeyboard";

interface DocumentSwitcherProps {
  currentPath: string | null;
  currentSourcePath?: string | null;
  currentTitle?: string;
  open: boolean;
  recentDocuments: RecentDocument[];
  onOpenChange: (open: boolean) => void;
  onOpenFile: () => void;
  onOpenRecent: (path: string) => void;
  onRevealCurrent: (path: string) => void;
  onRevealRecent: (path: string) => void;
  onCopyDocumentPath: (path: string) => void;
  onMoveRecent: (path: string) => void;
  onForgetRecent: (path: string) => void;
  onDeleteDocument?: (path: string) => void;
  showFileActions?: boolean;
}

const actionsHoverOpenDelay = 260;
const actionsHoverCloseDelay = 180;

function formatRecentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

export function DocumentSwitcher({
  currentPath,
  currentSourcePath = null,
  currentTitle,
  open,
  recentDocuments,
  onOpenChange,
  onOpenFile,
  onOpenRecent,
  onRevealCurrent,
  onRevealRecent,
  onCopyDocumentPath,
  onMoveRecent,
  onForgetRecent,
  onDeleteDocument,
  showFileActions = true,
}: DocumentSwitcherProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const actionsOpenTimerRef = useRef<number | null>(null);
  const actionsCloseTimerRef = useRef<number | null>(null);
  const focusActionsOnOpenRef = useRef(false);
  const [actionsPath, setActionsPath] = useState<string | null>(null);
  const [actionsMenuTop, setActionsMenuTop] = useState<number | null>(null);
  const currentDocument = describeCurrentDocument({
    documentPath: currentPath,
    sourcePath: currentSourcePath,
  });
  const visibleDocuments = visibleRecentDocuments(
    recentDocuments,
    currentDocument.associatedPath,
    showFileActions ? 5 : null,
  );

  const positionActionsMenu = useCallback(() => {
    const anchor = actionsTriggerRef.current;
    const popover = popoverRef.current;
    const menu = actionsMenuRef.current;
    if (!anchor || !popover || !menu) return;
    const anchorBounds = anchor.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const menuHeight = menu.getBoundingClientRect().height;
    const desiredTop = anchorBounds.top - 6;
    const boundedTop = Math.max(
      12,
      Math.min(desiredTop, window.innerHeight - menuHeight - 12),
    );
    setActionsMenuTop(boundedTop - popoverBounds.top);
  }, []);

  useEffect(() => {
    if (!open) {
      if (actionsOpenTimerRef.current !== null) {
        window.clearTimeout(actionsOpenTimerRef.current);
        actionsOpenTimerRef.current = null;
      }
      if (actionsCloseTimerRef.current !== null) {
        window.clearTimeout(actionsCloseTimerRef.current);
        actionsCloseTimerRef.current = null;
      }
      setActionsPath(null);
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener(
      "pointerdown",
      handlePointerDown,
    );
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!actionsPath || !focusActionsOnOpenRef.current) return;
    focusActionsOnOpenRef.current = false;
    window.requestAnimationFrame(() => {
      actionsMenuRef.current
        ?.querySelector<HTMLButtonElement>("[role='menuitem']")
        ?.focus({ preventScroll: true });
    });
  }, [actionsPath]);

  useLayoutEffect(() => {
    if (!actionsPath) {
      setActionsMenuTop(null);
      return;
    }
    positionActionsMenu();
    window.addEventListener("resize", positionActionsMenu);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(positionActionsMenu);
    if (actionsMenuRef.current) observer?.observe(actionsMenuRef.current);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    return () => {
      window.removeEventListener("resize", positionActionsMenu);
      observer?.disconnect();
    };
  }, [actionsPath, positionActionsMenu]);

  useEffect(
    () => () => {
      if (actionsOpenTimerRef.current !== null) {
        window.clearTimeout(actionsOpenTimerRef.current);
      }
      if (actionsCloseTimerRef.current !== null) {
        window.clearTimeout(actionsCloseTimerRef.current);
      }
    },
    [],
  );

  const menuItems = () =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-document-switcher-item='true']",
      ) ?? [],
    );

  const focusMenuItem = (position: "first" | "last") => {
    window.requestAnimationFrame(() => {
      const items = menuItems();
      items[position === "first" ? 0 : items.length - 1]?.focus();
    });
  };

  const openAt = (position: "first" | "last") => {
    onOpenChange(true);
    focusMenuItem(position);
  };

  const close = (restoreFocus = true) => {
    if (actionsOpenTimerRef.current !== null) {
      window.clearTimeout(actionsOpenTimerRef.current);
      actionsOpenTimerRef.current = null;
    }
    if (actionsCloseTimerRef.current !== null) {
      window.clearTimeout(actionsCloseTimerRef.current);
      actionsCloseTimerRef.current = null;
    }
    setActionsPath(null);
    onOpenChange(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() =>
        triggerRef.current?.focus({ preventScroll: true }),
      );
    }
  };

  const clearActionsOpenTimer = () => {
    if (actionsOpenTimerRef.current === null) return;
    window.clearTimeout(actionsOpenTimerRef.current);
    actionsOpenTimerRef.current = null;
  };

  const clearActionsCloseTimer = () => {
    if (actionsCloseTimerRef.current === null) return;
    window.clearTimeout(actionsCloseTimerRef.current);
    actionsCloseTimerRef.current = null;
  };

  const closeActions = (restoreFocus = true) => {
    clearActionsOpenTimer();
    clearActionsCloseTimer();
    const returnFocus = actionsTriggerRef.current;
    setActionsPath(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() =>
        returnFocus?.focus({ preventScroll: true }),
      );
    }
  };

  const openActions = (path: string, focusFirstItem: boolean) => {
    clearActionsOpenTimer();
    clearActionsCloseTimer();
    focusActionsOnOpenRef.current = focusFirstItem;
    setActionsPath(path);
  };

  const scheduleActionsOpen = (path: string) => {
    clearActionsCloseTimer();
    if (actionsPath === path || actionsOpenTimerRef.current !== null) {
      return;
    }
    actionsOpenTimerRef.current = window.setTimeout(() => {
      actionsOpenTimerRef.current = null;
      focusActionsOnOpenRef.current = false;
      setActionsPath(path);
    }, actionsHoverOpenDelay);
  };

  const cancelScheduledActionsOpen = () => {
    clearActionsOpenTimer();
  };

  const scheduleActionsClose = () => {
    clearActionsOpenTimer();
    clearActionsCloseTimer();
    if (!actionsPath) return;
    actionsCloseTimerRef.current = window.setTimeout(() => {
      actionsCloseTimerRef.current = null;
      setActionsPath(null);
    }, actionsHoverCloseDelay);
  };

  const keepActionsOpen = () => {
    clearActionsCloseTimer();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest(
        ".document-switcher__actions-menu",
      )
    ) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      onOpenChange(false);
      return;
    }
    // Arrow flow stays on the switcher's own list entries; the hover-managed
    // actions submenu and the row-level "更多操作" trigger join only through
    // their own entry points.
    if (
      moveMenuFocus(
        event.currentTarget,
        event.key,
        "[role='menuitem'][data-document-switcher-item='true']:not(:disabled)",
      )
    ) {
      event.preventDefault();
    }
  };

  const handleActionsKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      closeActions();
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (moveMenuFocus(event.currentTarget, event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  useEffect(() => {
    if (!actionsPath) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        actionsMenuRef.current?.contains(target) ||
        actionsTriggerRef.current?.contains(target)
      ) {
        return;
      }
      clearActionsOpenTimer();
      clearActionsCloseTimer();
      setActionsPath(null);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener(
        "pointerdown",
        handlePointerDown,
        true,
      );
  }, [actionsPath]);

  const runRecentAction = (
    path: string,
    action: (path: string) => void,
  ) => {
    close(false);
    action(path);
  };
  const actionsIsCurrent = Boolean(
    currentTitle !== undefined &&
      currentDocument.pathRole &&
      actionsPath === currentDocument.associatedPath,
  );
  const actionsDocument = actionsPath
    ? actionsIsCurrent
      ? {
          path: actionsPath,
          title: currentTitle ?? "当前文档",
          lastOpenedAt: "",
        }
      : visibleDocuments.find((document) => document.path === actionsPath)
    : undefined;

  return (
    <div className="document-switcher" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="切换思维导图"
        className="document-switcher__trigger"
        onClick={(event) => {
          // WebKit does not focus buttons on pointer activation. Keep menu
          // keys on its trigger instead of the previously focused canvas.
          event.currentTarget.focus({ preventScroll: true });
          onOpenChange(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openAt("first");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openAt("last");
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <Icon name="chevronDown" size={16} />
      </button>

      {open && (
        <div
          aria-describedby={
            showFileActions ? undefined : "browser-storage-note"
          }
          className="document-switcher__popover"
          onKeyDown={handleMenuKeyDown}
          ref={popoverRef}
          role="menu"
        >
          {currentTitle !== undefined && (
            <>
              <span className="document-switcher__heading">正在编辑</span>
              <div
                aria-label={`${currentTitle}，${currentDocument.exactDescription}`}
                className="document-switcher__current-row"
                onContextMenu={(event) => {
                  if (!currentDocument.pathRole || !currentDocument.associatedPath) {
                    return;
                  }
                  event.preventDefault();
                  openActions(currentDocument.associatedPath, true);
                }}
                role="group"
                title={currentDocument.exactDescription}
              >
                <Icon name="check" size={16} />
                <span className="document-switcher__item-copy">
                  <strong>{currentTitle}</strong>
                  <small>{currentDocument.metadata}</small>
                </span>
                {showFileActions &&
                  currentDocument.pathRole &&
                  currentDocument.associatedPath && (
                    <button
                      aria-expanded={actionsIsCurrent}
                      aria-haspopup="menu"
                      aria-label={`当前文件操作：${currentTitle}`}
                      className="document-switcher__recent-more"
                      data-document-switcher-item="true"
                      onClick={() => {
                        if (actionsIsCurrent) {
                          closeActions(false);
                        } else {
                          openActions(
                            currentDocument.associatedPath!,
                            true,
                          );
                        }
                      }}
                      onPointerEnter={() =>
                        scheduleActionsOpen(currentDocument.associatedPath!)
                      }
                      onPointerLeave={() => {
                        cancelScheduledActionsOpen();
                        scheduleActionsClose();
                      }}
                      ref={actionsIsCurrent ? actionsTriggerRef : undefined}
                      role="menuitem"
                      type="button"
                    >
                      <Icon name="more" size={16} />
                    </button>
                  )}
              </div>
              <span className="document-switcher__divider" />
            </>
          )}
          <span className="document-switcher__heading">
            {currentTitle === undefined
              ? showFileActions
                ? "最近编辑"
                : "文档库"
              : showFileActions
                ? "其他最近文档"
                : "其他文档"}
          </span>
          {visibleDocuments.length === 0 ? (
            <span className="document-switcher__empty">
              {showFileActions ? "暂无其他最近文档" : "暂无其他文档"}
            </span>
          ) : (
            <div
              className="document-switcher__list"
              onScroll={() => closeActions(false)}
              role="none"
            >
            {visibleDocuments.map((document) => {
              const internal = isInternalDocumentPath(document.path);
              const time = formatRecentTime(document.lastOpenedAt);
              const metadata = [
                recentDocumentLocation(document.path),
                time,
              ].filter(Boolean).join(" · ");
              const actionsOpen = actionsPath === document.path;
              return (
                <div
                  className="document-switcher__recent-row"
                  key={document.path}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openActions(document.path, true);
                  }}
                  role="none"
                >
                  <button
                    className="document-switcher__recent"
                    data-document-switcher-item="true"
                    onClick={() => {
                      close(false);
                      onOpenRecent(document.path);
                    }}
                    role="menuitem"
                    title={internal ? undefined : document.path}
                    type="button"
                  >
                    <Icon name="file" size={17} />
                    <span className="document-switcher__item-copy">
                      <strong>{document.title}</strong>
                      <small>{metadata}</small>
                    </span>
                  </button>
                  {showFileActions && (
                    <button
                      aria-expanded={actionsOpen}
                      aria-haspopup="menu"
                      aria-label={`更多操作：${document.title}`}
                      className="document-switcher__recent-more"
                      data-document-switcher-item="true"
                      onClick={() => {
                        if (actionsOpen) {
                          closeActions(false);
                        } else {
                          openActions(document.path, true);
                        }
                      }}
                      onPointerEnter={() =>
                        scheduleActionsOpen(document.path)
                      }
                      onPointerLeave={() => {
                        cancelScheduledActionsOpen();
                        scheduleActionsClose();
                      }}
                      ref={actionsOpen ? actionsTriggerRef : undefined}
                      role="menuitem"
                      type="button"
                    >
                      <Icon name="more" size={16} />
                    </button>
                  )}
                  {!showFileActions && onDeleteDocument && (
                    <button
                      aria-label={`删除：${document.title}`}
                      className="document-switcher__recent-more"
                      data-document-switcher-item="true"
                      onClick={() =>
                        runRecentAction(document.path, onDeleteDocument)
                      }
                      role="menuitem"
                      type="button"
                    >
                      <Icon name="minus" size={16} />
                    </button>
                  )}
                </div>
              );
            })}
            </div>
          )}
          {showFileActions && actionsDocument && (
            <div
              aria-label={`${actionsDocument.title}的文件操作`}
              className="document-switcher__actions-menu"
              onKeyDown={handleActionsKeyDown}
              onPointerEnter={keepActionsOpen}
              onPointerLeave={scheduleActionsClose}
              ref={actionsMenuRef}
              role="menu"
              style={{
                top: actionsMenuTop ?? -6,
                visibility: actionsMenuTop === null ? "hidden" : "visible",
              }}
            >
              {!isInternalDocumentPath(actionsDocument.path) && (
                <>
                  <button
                    onClick={() =>
                      runRecentAction(
                        actionsDocument.path,
                        actionsIsCurrent
                          ? onRevealCurrent
                          : onRevealRecent,
                      )
                    }
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="folder" size={16} />
                    <span>
                      {actionsIsCurrent && currentDocument.pathRole === "source"
                        ? "在访达中显示来源"
                        : "在访达中显示"}
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      runRecentAction(
                        actionsDocument.path,
                        onCopyDocumentPath,
                      )
                    }
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="code" size={16} />
                    <span>
                      {actionsIsCurrent && currentDocument.pathRole === "source"
                        ? "复制来源路径"
                        : "复制路径"}
                    </span>
                  </button>
                </>
              )}
              {!actionsIsCurrent && isInternalDocumentPath(actionsDocument.path) && (
                <button
                  onClick={() =>
                    runRecentAction(
                      actionsDocument.path,
                      onMoveRecent,
                    )
                  }
                  role="menuitem"
                  type="button"
                >
                  <Icon name="folder" size={16} />
                  <span>移动到…</span>
                </button>
              )}
              {!actionsIsCurrent && (
                <button
                  onClick={() =>
                    runRecentAction(
                      actionsDocument.path,
                      onForgetRecent,
                    )
                  }
                  role="menuitem"
                  type="button"
                >
                  <Icon name="minus" size={16} />
                  <span>从最近编辑中移除</span>
                </button>
              )}
            </div>
          )}
          <span className="document-switcher__divider" />
          <button
            data-document-switcher-item="true"
            onClick={() => {
              close(false);
              onOpenFile();
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="folder" size={17} />
            <span>打开文件…</span>
          </button>
          {!showFileActions && (
            <div role="none">
              <p
                className="document-switcher__storage-note"
                id="browser-storage-note"
              >
                内容保存在此浏览器
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
