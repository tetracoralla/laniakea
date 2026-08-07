import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  isInternalDocumentPath,
  recentDocumentLocation,
  visibleRecentDocuments,
  type RecentDocument,
} from "../../persistence/recentDocuments";
import { Icon } from "../icons/Icon";

interface DocumentSwitcherProps {
  currentPath: string | null;
  open: boolean;
  recentDocuments: RecentDocument[];
  onOpenChange: (open: boolean) => void;
  onOpenFile: () => void;
  onOpenRecent: (path: string) => void;
  onRevealRecent: (path: string) => void;
  onCopyRecentPath: (path: string) => void;
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
  open,
  recentDocuments,
  onOpenChange,
  onOpenFile,
  onOpenRecent,
  onRevealRecent,
  onCopyRecentPath,
  onMoveRecent,
  onForgetRecent,
  onDeleteDocument,
  showFileActions = true,
}: DocumentSwitcherProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const actionsOpenTimerRef = useRef<number | null>(null);
  const actionsCloseTimerRef = useRef<number | null>(null);
  const focusActionsOnOpenRef = useRef(false);
  const [actionsPath, setActionsPath] = useState<string | null>(null);
  const visibleDocuments = visibleRecentDocuments(
    recentDocuments,
    currentPath,
    showFileActions ? 5 : null,
  );

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
    const items = menuItems();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
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

  const handleActionsKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[role='menuitem']",
      ),
    );
    const index = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
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
    if (
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
      items.length === 0
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
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

  return (
    <div className="document-switcher" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="切换思维导图"
        className="document-switcher__trigger"
        onClick={() => onOpenChange(!open)}
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
          role="menu"
        >
          <span className="document-switcher__heading">
            {showFileActions ? "最近编辑" : "文档库"}
          </span>
          {visibleDocuments.length === 0 ? (
            <span className="document-switcher__empty">
              {showFileActions ? "暂无其他最近文档" : "暂无其他文档"}
            </span>
          ) : (
            <div className="document-switcher__list" role="none">
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
                  {showFileActions && actionsOpen && (
                    <div
                      aria-label={`${document.title}的文件操作`}
                      className="document-switcher__actions-menu"
                      onKeyDown={handleActionsKeyDown}
                      onPointerEnter={keepActionsOpen}
                      onPointerLeave={scheduleActionsClose}
                      ref={actionsMenuRef}
                      role="menu"
                    >
                      {!internal && (
                        <>
                          <button
                            onClick={() =>
                              runRecentAction(
                                document.path,
                                onRevealRecent,
                              )
                            }
                            role="menuitem"
                            type="button"
                          >
                            <Icon name="folder" size={16} />
                            <span>在访达中显示</span>
                          </button>
                          <button
                            onClick={() =>
                              runRecentAction(
                                document.path,
                                onCopyRecentPath,
                              )
                            }
                            role="menuitem"
                            type="button"
                          >
                            <Icon name="code" size={16} />
                            <span>复制路径</span>
                          </button>
                        </>
                      )}
                      {internal && (
                        <button
                          onClick={() =>
                            runRecentAction(
                              document.path,
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
                      <button
                        onClick={() =>
                          runRecentAction(
                            document.path,
                            onForgetRecent,
                          )
                        }
                        role="menuitem"
                        type="button"
                      >
                        <Icon name="minus" size={16} />
                        <span>从最近编辑中移除</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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
                内容保存在此浏览器，建议定期导出完整备份
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
