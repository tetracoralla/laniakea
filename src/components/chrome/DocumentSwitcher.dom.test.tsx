// @vitest-environment jsdom

import { configureInternalDocumentRoot } from "../../persistence/recentDocuments";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentSwitcher } from "./DocumentSwitcher";

configureInternalDocumentRoot(
  "/Volumes/Workspace/Library/Application Support/com.openadam.origin",
);

describe("recent document file actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("separates the current save target from a same-named recent file", async () => {
    const desktopPath = "/Users/test/Desktop/项目计划.md";
    const downloadsPath = "/Users/test/Downloads/项目计划.md";
    const onRevealCurrent = vi.fn();
    const onRevealRecent = vi.fn();
    const onCopyDocumentPath = vi.fn();

    await act(async () => {
      root.render(
        <DocumentSwitcher
          currentPath={desktopPath}
          currentSourcePath={desktopPath}
          currentTitle="项目计划"
          onCopyDocumentPath={onCopyDocumentPath}
          onForgetRecent={vi.fn()}
          onMoveRecent={vi.fn()}
          onOpenChange={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenRecent={vi.fn()}
          onRevealCurrent={onRevealCurrent}
          onRevealRecent={onRevealRecent}
          open
          recentDocuments={[
            {
              path: desktopPath,
              title: "项目计划",
              lastOpenedAt: "2026-09-04T07:38:00.461Z",
            },
            {
              path: downloadsPath,
              title: "项目计划",
              lastOpenedAt: "2026-09-02T14:14:02.919Z",
            },
          ]}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      ".document-switcher__trigger",
    )!;
    expect(trigger.textContent).toBe("");
    expect(trigger.getAttribute("aria-label")).toBe("切换思维导图");
    expect(
      container.querySelector(".document-switcher__current-row")?.textContent,
    ).toContain("项目计划保存到 · 桌面");
    expect(container.textContent).toContain("其他最近文档");

    const recentItems = container.querySelectorAll(
      ".document-switcher__recent",
    );
    expect(recentItems).toHaveLength(1);
    expect(recentItems[0]?.getAttribute("title")).toBe(downloadsPath);

    const popover = container.querySelector<HTMLElement>(
      ".document-switcher__popover",
    )!;
    const openFile = Array.from(
      popover.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
    ).find((button) => button.textContent?.includes("打开文件"))!;
    const currentActionsTrigger = container.querySelector<HTMLButtonElement>(
      "button[aria-label='当前文件操作：项目计划']",
    )!;
    openFile.focus();
    await act(async () => {
      popover.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowDown",
        }),
      );
    });
    expect(document.activeElement).toBe(currentActionsTrigger);

    await act(async () => {
      currentActionsTrigger.click();
    });
    const currentActions = container.querySelector<HTMLElement>(
      ".document-switcher__actions-menu",
    )!;
    expect(currentActions.textContent).toContain("复制路径");
    expect(currentActions.textContent).not.toContain("从最近编辑中移除");
    await act(async () => {
      Array.from(currentActions.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("在文件夹中显示"))
        ?.click();
    });
    expect(onRevealCurrent).toHaveBeenCalledWith(desktopPath);
    expect(onRevealRecent).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "button[aria-label='当前文件操作：项目计划']",
      )!.click();
    });
    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".document-switcher__actions-menu button",
        ),
      )
        .find((button) => button.textContent?.includes("复制路径"))
        ?.click();
    });
    expect(onCopyDocumentPath).toHaveBeenCalledWith(desktopPath);

    await act(async () => {
      root.render(
        <DocumentSwitcher
          currentPath={null}
          currentSourcePath={downloadsPath}
          currentTitle="项目计划"
          onCopyDocumentPath={vi.fn()}
          onForgetRecent={vi.fn()}
          onMoveRecent={vi.fn()}
          onOpenChange={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenRecent={vi.fn()}
          onRevealCurrent={vi.fn()}
          onRevealRecent={vi.fn()}
          open
          recentDocuments={[
            {
              path: downloadsPath,
              title: "项目计划",
              lastOpenedAt: "2026-09-02T14:14:02.919Z",
            },
          ]}
        />,
      );
    });
    expect(
      container.querySelector(".document-switcher__trigger")?.textContent,
    ).toBe("");
    expect(
      container.querySelector(".document-switcher__current-row")?.textContent,
    ).toContain("尚未另存 · 来源：下载");
    expect(container.querySelectorAll(".document-switcher__recent"))
      .toHaveLength(0);
  });

  it("keeps reopen primary while exposing contextual user-file actions", async () => {
    const onOpenRecent = vi.fn();
    const onRevealRecent = vi.fn();
    const onCopyDocumentPath = vi.fn();
    const onForgetRecent = vi.fn();
    const externalPath =
      "/Volumes/Workspace/Documents/客户项目/验收想法.md";
    const internalPath =
      "/Volumes/Workspace/Library/Application Support/com.openadam.origin/drafts/未命名.md";

    await act(async () => {
      root.render(
        <DocumentSwitcher
          currentPath={null}
          onCopyDocumentPath={onCopyDocumentPath}
          onForgetRecent={onForgetRecent}
          onMoveRecent={vi.fn()}
          onOpenChange={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenRecent={onOpenRecent}
          onRevealCurrent={vi.fn()}
          onRevealRecent={onRevealRecent}
          open
          recentDocuments={[
            {
              path: externalPath,
              title: "验收想法",
              lastOpenedAt: "2026-07-30T10:00:00.000Z",
            },
            {
              path: internalPath,
              title: "未命名思维",
              lastOpenedAt: "2026-07-29T10:00:00.000Z",
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Documents/客户项目");
    expect(container.textContent).toContain("本地草稿");

    const recent = container.querySelector<HTMLButtonElement>(
      ".document-switcher__recent",
    )!;
    await act(async () => recent.click());
    expect(onOpenRecent).toHaveBeenCalledWith(externalPath);

    const externalMore = container.querySelector<HTMLButtonElement>(
      "button[aria-label='更多操作：验收想法']",
    )!;
    await act(async () => externalMore.click());

    expect(container.textContent).toContain("在文件夹中显示");
    expect(container.textContent).toContain("复制路径");
    expect(container.textContent).toContain("从最近编辑中移除");

    const actionMenu = container.querySelector<HTMLElement>(
      ".document-switcher__actions-menu",
    )!;
    expect(actionMenu.closest(".document-switcher__list")).toBeNull();
    expect(actionMenu.parentElement).toBe(
      container.querySelector(".document-switcher__popover"),
    );
    await act(async () => {
      actionMenu.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape",
        }),
      );
    });
    expect(container.querySelector(
      ".document-switcher__actions-menu",
    )).toBeNull();
    expect(document.activeElement).toBe(externalMore);

    const internalRow = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".document-switcher__recent-row",
      ),
    )[1]!;
    await act(async () => {
      internalRow.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
        }),
      );
    });

    const internalActions = container.querySelector<HTMLElement>(
      ".document-switcher__actions-menu",
    )!;
    expect(internalActions.textContent).not.toContain("在文件夹中显示");
    expect(internalActions.textContent).not.toContain("复制路径");
    expect(internalActions.textContent).toContain("移动到…");
    const remove = Array.from(
      internalActions.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) =>
      button.textContent?.includes("从最近编辑中移除"),
    )!;
    await act(async () => remove.click());
    expect(onForgetRecent).toHaveBeenCalledWith(internalPath);
  });

  it("opens actions after hover intent and closes after leaving or clicking elsewhere", async () => {
    vi.useFakeTimers();
    const externalPath = "/Volumes/Workspace/Documents/验收想法.md";

    await act(async () => {
      root.render(
        <DocumentSwitcher
          currentPath={null}
          onCopyDocumentPath={vi.fn()}
          onForgetRecent={vi.fn()}
          onMoveRecent={vi.fn()}
          onOpenChange={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenRecent={vi.fn()}
          onRevealCurrent={vi.fn()}
          onRevealRecent={vi.fn()}
          open
          recentDocuments={[
            {
              path: externalPath,
              title: "验收想法",
              lastOpenedAt: "2026-07-30T10:00:00.000Z",
            },
          ]}
        />,
      );
    });

    const more = container.querySelector<HTMLButtonElement>(
      "button[aria-label='更多操作：验收想法']",
    )!;
    await act(async () => {
      more.dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true }),
      );
      vi.advanceTimersByTime(259);
    });
    expect(container.querySelector(
      ".document-switcher__actions-menu",
    )).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    const menu = container.querySelector<HTMLElement>(
      ".document-switcher__actions-menu",
    )!;
    expect(menu).not.toBeNull();

    await act(async () => {
      more.dispatchEvent(
        new MouseEvent("pointerout", {
          bubbles: true,
          relatedTarget: menu,
        }),
      );
      menu.dispatchEvent(
        new MouseEvent("pointerover", {
          bubbles: true,
          relatedTarget: more,
        }),
      );
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector(
      ".document-switcher__actions-menu",
    )).not.toBeNull();

    await act(async () => {
      menu.dispatchEvent(
        new MouseEvent("pointerout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
      vi.advanceTimersByTime(180);
    });
    expect(container.querySelector(
      ".document-switcher__actions-menu",
    )).toBeNull();

    await act(async () => more.click());
    expect(container.querySelector(
      ".document-switcher__actions-menu",
    )).not.toBeNull();

    const heading = container.querySelector<HTMLElement>(
      ".document-switcher__heading",
    )!;
    await act(async () => {
      heading.dispatchEvent(
        new Event("pointerdown", { bubbles: true }),
      );
    });
    expect(container.querySelector(
      ".document-switcher__actions-menu",
    )).toBeNull();
    expect(container.querySelector(
      ".document-switcher__popover",
    )).not.toBeNull();

    vi.useRealTimers();
  });

  it("repositions an open actions menu when the viewport changes", async () => {
    const externalPath = "/Volumes/Workspace/Documents/验收想法.md";
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    let menuHeight = 120;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("document-switcher__popover")) {
        return { top: 100 } as DOMRect;
      }
      if (this.classList.contains("document-switcher__recent-more")) {
        return { top: 600 } as DOMRect;
      }
      if (this.classList.contains("document-switcher__actions-menu")) {
        return { height: menuHeight } as DOMRect;
      }
      return originalBounds.call(this);
    };
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
      writable: true,
    });

    try {
      await act(async () => {
        root.render(
          <DocumentSwitcher
            currentPath={null}
            onCopyDocumentPath={vi.fn()}
            onForgetRecent={vi.fn()}
            onMoveRecent={vi.fn()}
            onOpenChange={vi.fn()}
            onOpenFile={vi.fn()}
            onOpenRecent={vi.fn()}
            onRevealCurrent={vi.fn()}
            onRevealRecent={vi.fn()}
            open
            recentDocuments={[{
              path: externalPath,
              title: "验收想法",
              lastOpenedAt: "2026-07-30T10:00:00.000Z",
            }]}
          />,
        );
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>(
          "button[aria-label='更多操作：验收想法']",
        )!.click();
      });
      const menu = container.querySelector<HTMLElement>(
        ".document-switcher__actions-menu",
      )!;
      expect(menu.style.top).toBe("494px");

      menuHeight = 220;
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(menu.style.top).toBe("468px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalBounds;
    }
  });

  it("shows the complete browser library and exposes real deletion", async () => {
    const onOpenRecent = vi.fn();
    const onDeleteDocument = vi.fn();
    const documents = Array.from({ length: 8 }, (_, index) => ({
      path: `browser://laniakea/document-${index}`,
      title: `文档 ${index}`,
      lastOpenedAt: new Date(2026, 6, index + 1).toISOString(),
    }));

    await act(async () => {
      root.render(
        <DocumentSwitcher
          currentPath={documents[0].path}
          onCopyDocumentPath={vi.fn()}
          onDeleteDocument={onDeleteDocument}
          onForgetRecent={vi.fn()}
          onMoveRecent={vi.fn()}
          onOpenChange={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenRecent={onOpenRecent}
          onRevealCurrent={vi.fn()}
          onRevealRecent={vi.fn()}
          open
          recentDocuments={documents}
          showFileActions={false}
        />,
      );
    });

    const libraryItems = container.querySelectorAll(
      ".document-switcher__recent",
    );
    expect(container.textContent).toContain("文档库");
    expect(container.textContent).toContain(
      "内容保存在此浏览器",
    );
    expect(libraryItems).toHaveLength(7);
    await act(async () => {
      (libraryItems[6] as HTMLButtonElement).click();
    });
    expect(onOpenRecent).toHaveBeenCalledWith(documents[7].path);

    const deleteOldest = container.querySelector<HTMLButtonElement>(
      `button[aria-label='删除：${documents[7].title}']`,
    )!;
    await act(async () => deleteOldest.click());
    expect(onDeleteDocument).toHaveBeenCalledWith(documents[7].path);
  });
});
